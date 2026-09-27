import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createCodexSkillEvidenceCollector } from "../../../src/index.js";
import {
  bindDeploymentSnapshot,
  deploymentEntry,
  FIXTURE_ASSETS,
  FIXTURE_NAME,
  fixtureCatalog,
} from "../src/manifest.js";
import { bindFixtureOtelProjection } from "../src/otel-projection.js";
import { runGitDeploymentFixture } from "../src/run-git-fixture.js";

const root = resolve(fileURLToPath(new URL("../../../..", import.meta.url)));
const [a, b] = await Promise.all(
  ["a", "b"].map((revision) =>
    readFile(
      resolve(
        root,
        "experiments/deployment-snapshot/fixtures",
        revision,
        "SKILL.md",
      ),
    ),
  ),
);
assert.ok(a && b);
const catalog = fixtureCatalog(a, b);
const entryA = deploymentEntry(catalog, FIXTURE_ASSETS[0], "a", "a");
const entryB = deploymentEntry(catalog, FIXTURE_ASSETS[0], "b", "b");
const presence = {
  schemaVersion: 1,
  provider: "codex",
  signal: "skill-injected",
  observationScope: "collector-lifetime",
  injectedSkills: [FIXTURE_NAME],
  unrecognizedSkillObserved: false,
};

function attributes(
  packet: ReturnType<ReturnType<typeof bindFixtureOtelProjection>["project"]>,
  index: number,
) {
  return Object.fromEntries(
    packet.resourceLogs[0]!.scopeLogs[index]!.logRecords[0]!.attributes.map(
      ({ key, value }) => [
        key,
        "stringValue" in value ? value.stringValue : value.boolValue,
      ],
    ),
  );
}

test("OTLP projection fixes earlier deployment and separates provider facts from wrapper candidates", () => {
  const mutable = { ...entryA, privateData: "PRIVATE_ENTRY" };
  const supplied = {
    ...bindDeploymentSnapshot(catalog, [], null),
    entries: [mutable],
    secret: "PRIVATE_MANIFEST",
  };
  const project = bindFixtureOtelProjection(catalog, supplied);
  mutable.contentDigest = catalog.digests.b;
  const packet = project.project({
    ...presence,
    privateData: "PRIVATE_PRESENCE",
  });
  const provider = attributes(packet, 0);
  const wrapper = attributes(packet, 1);
  assert.equal(provider["renma.provenance"], "synthetic-provider-projection");
  assert.equal(provider["renma.provider.presence_observed"], true);
  assert.equal(wrapper["renma.deployment.content_digest"], catalog.digests.a);
  assert.equal(wrapper["renma.deployment.injected_revision"], "unsupported");
  assert.equal(
    wrapper["renma.deployment.candidate_resolution"],
    "unique-deployment-candidate",
  );
  assert.ok(
    Object.keys(provider).every((key) => !key.startsWith("renma.deployment.")),
  );
  assert.ok(
    Object.keys(wrapper).every((key) => !key.startsWith("renma.provider.")),
  );
  assert.equal(JSON.stringify(packet).includes("PRIVATE"), false);
  assert.equal(JSON.stringify(packet).includes(catalog.digests.b), false);
  // Mutating an exported packet cannot change the pre-bound projection.
  packet.resourceLogs.pop();
  assert.equal(
    attributes(project.project(presence), 1)["renma.deployment.content_digest"],
    catalog.digests.a,
  );
});

test("ambiguous, unmapped and absent presence never export a chosen digest or asset", () => {
  for (const [entries, input, expected] of [
    [[entryA, entryB], presence, "ambiguous"],
    [[], presence, "unmapped"],
    [[entryA], { ...presence, injectedSkills: [] }, "no-provider-presence"],
  ] as const) {
    const packet = bindFixtureOtelProjection(
      catalog,
      bindDeploymentSnapshot(catalog, entries, null),
    ).project(input);
    const wrapper = attributes(packet, 1);
    assert.equal(wrapper["renma.deployment.candidate_resolution"], expected);
    assert.equal(wrapper["renma.deployment.content_digest"], undefined);
    assert.equal(wrapper["renma.deployment.asset_id"], undefined);
    assert.equal(wrapper["renma.deployment.commit"], undefined);
  }
});

test("unknown labels become only a boolean and malformed provider semantics fail closed", () => {
  const project = bindFixtureOtelProjection(
    catalog,
    bindDeploymentSnapshot(catalog, [entryA], null),
  );
  const packet = project.project({
    ...presence,
    injectedSkills: [FIXTURE_NAME, "PRIVATE_UNKNOWN_LABEL"],
  });
  assert.equal(
    attributes(packet, 0)["renma.provider.unrecognized_label_observed"],
    true,
  );
  assert.equal(JSON.stringify(packet).includes("PRIVATE"), false);
  for (const change of [
    { provider: "other" },
    { signal: "executed" },
    { schemaVersion: 2 },
    { observationScope: "session" },
    { unrecognizedSkillObserved: "false" },
    { injectedSkills: [null] },
  ]) {
    assert.throws(() => project.project({ ...presence, ...change }), {
      message: "Invalid fixture presence snapshot",
    });
  }
});

test("synthetic OTLP metric reduction and snapshot export round-trip over loopback", async () => {
  // Snapshot binding precedes receiver creation. A later sync pointer is not read.
  const git = await runGitDeploymentFixture();
  let latest = git.boundA;
  const projection = bindFixtureOtelProjection(catalog, latest);
  const collector = await createCodexSkillEvidenceCollector({
    allowedSkills: [FIXTURE_NAME],
  });
  const accepted = { value: false };
  let expectedBytes: Buffer | undefined;
  const server = createServer((request, response) => {
    if (
      request.method !== "POST" ||
      request.url !== "/v1/logs" ||
      request.headers["content-type"] !== "application/json"
    ) {
      response.writeHead(400).end();
      return;
    }
    // Compare each received byte against the already-allowlisted projection.
    // No request body, parsed arbitrary fields, or unknown strings are retained.
    let offset = 0;
    let matches = true;
    request.on("data", (chunk: Buffer) => {
      if (
        !expectedBytes ||
        offset + chunk.length > expectedBytes.length ||
        !chunk.equals(expectedBytes.subarray(offset, offset + chunk.length))
      )
        matches = false;
      offset = Math.min(16_385, offset + chunk.length);
      if (offset > 16_384) request.destroy();
    });
    request.on("error", () => {
      matches = false;
    });
    request.on("end", () => {
      accepted.value = matches && offset === expectedBytes?.length;
      response
        .writeHead(accepted.value ? 200 : 400, {
          "Content-Type": "application/json",
        })
        .end("{}");
    });
  });
  server.requestTimeout = 5_000;
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");
    latest = git.boundB;
    const response = await fetch(collector.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resourceMetrics: [
          {
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: "codex.skill.injected",
                    sum: {
                      dataPoints: [
                        {
                          asInt: "1",
                          attributes: [
                            {
                              key: "skill",
                              value: { stringValue: FIXTURE_NAME },
                            },
                            { key: "status", value: { stringValue: "ok" } },
                          ],
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(5_000),
    });
    assert.equal(response.status, 200);
    await response.body?.cancel();
    const reduced = await collector.closeAndSnapshot();
    assert.deepEqual(reduced.injectedSkills, [FIXTURE_NAME]);
    const packet = projection.project(reduced);
    assert.equal(
      attributes(packet, 1)["renma.deployment.content_digest"],
      catalog.digests.a,
    );
    assert.equal(latest.entries[0]?.contentDigest, catalog.digests.b);
    assert.equal(
      attributes(packet, 1)["renma.deployment.commit"],
      git.boundA.sourceRevision.commit,
    );
    assert.notEqual(
      attributes(packet, 1)["renma.deployment.commit"],
      latest.sourceRevision.commit,
    );
    assert.equal(attributes(packet, 0)["renma.deployment.commit"], undefined);
    expectedBytes = Buffer.from(JSON.stringify(packet));
    assert.ok(expectedBytes.length <= 16_384);
    const exported = await fetch(`http://127.0.0.1:${address.port}/v1/logs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: expectedBytes.toString("utf8"),
      signal: AbortSignal.timeout(5_000),
    });
    assert.equal(exported.status, 200);
    await exported.body?.cancel();
    assert.equal(accepted.value, true);
  } finally {
    await collector.closeAndSnapshot();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    expectedBytes = undefined;
  }
});
