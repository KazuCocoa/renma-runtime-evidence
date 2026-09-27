import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import protobuf from "protobufjs";
import { fixtureCatalog } from "../src/manifest.js";
import { bindFixtureOtelProjection } from "../src/otel-projection.js";
import { runGitDeploymentFixture } from "../src/run-git-fixture.js";

const root = resolve(fileURLToPath(new URL("../../../..", import.meta.url)));
const directory = resolve(root, "experiments/deployment-snapshot");
const vendor = resolve(directory, "vendor/opentelemetry-proto");
const upstream = JSON.parse(
  readFileSync(resolve(vendor, "UPSTREAM.json"), "utf8"),
) as {
  commit: string;
  sha256: Record<string, string>;
};

function requestType() {
  const schema = new protobuf.Root();
  // Permit only the pinned local proto files. No network/schema discovery.
  schema.resolvePath = (_origin, target) => {
    if (!(target in upstream.sha256) || !target.endsWith(".proto")) {
      throw new Error("Unrecognized OTLP schema import");
    }
    return resolve(vendor, target);
  };
  schema.loadSync("opentelemetry/proto/collector/logs/v1/logs_service.proto");
  return schema.lookupType(
    "opentelemetry.proto.collector.logs.v1.ExportLogsServiceRequest",
  );
}

test("vendored OTLP schemas and license match the pinned upstream digests", () => {
  assert.equal(upstream.commit, "700dafd2e89ad6266049000c616a589d884523d4");
  assert.equal(Object.keys(upstream.sha256).length, 5);
  for (const [path, expected] of Object.entries(upstream.sha256)) {
    assert.equal(
      createHash("sha256")
        .update(readFileSync(resolve(vendor, path)))
        .digest("hex"),
      expected,
    );
  }
});

test("actual OTLP protobuf encoder/decoder preserves paired synthetic provenance and real Git commits", async () => {
  const catalog = fixtureCatalog(
    readFileSync(resolve(directory, "fixtures/a/SKILL.md")),
    readFileSync(resolve(directory, "fixtures/b/SKILL.md")),
  );
  const git = await runGitDeploymentFixture();
  const request = requestType();
  const input = {
    schemaVersion: 1,
    provider: "codex",
    signal: "skill-injected",
    observationScope: "collector-lifetime",
    injectedSkills: ["renma-freshness-fixture"],
    unrecognizedSkillObserved: false,
  };
  const a = bindFixtureOtelProjection(catalog, git.boundA).project(input);
  const b = bindFixtureOtelProjection(catalog, git.boundB).project({
    ...input,
    unrecognizedSkillObserved: true,
  });
  // Split and reverse a two-snapshot batch at record boundaries. Both provenance
  // groups travel inside each record; this is a fixture, not a backend test.
  const snapshots = [a, b].reverse();
  for (const packet of snapshots) {
    const serialized = JSON.stringify(packet);
    const parsed = JSON.parse(serialized) as Record<string, unknown>;
    assert.equal(request.verify(parsed), null);
    const binary = request.encode(request.fromObject(parsed)).finish();
    const decoded = request.decode(binary);
    const object = request.toObject(decoded, {
      longs: String,
      defaults: false,
    });
    // Also detects accidentally unknown/misspelled fields dropped by protobuf.
    assert.deepEqual(object, parsed);
    const restored = object as typeof packet;
    assert.equal(restored.resourceLogs[0]!.scopeLogs[0]!.logRecords.length, 1);
    const record = restored.resourceLogs[0]!.scopeLogs[0]!.logRecords[0]!;
    const groups = Object.fromEntries(
      record.body.kvlistValue.values.map(({ key, value }) => [
        key,
        value.kvlistValue.values,
      ]),
    );
    const attributes = (name: string) =>
      Object.fromEntries(
        groups[name]!.map(({ key, value }) => [
          key,
          "stringValue" in value ? value.stringValue : value.boolValue,
        ]),
      );
    const provider = attributes("provider");
    const deployment = attributes("deployment");
    const isB = provider["renma.provider.unrecognized_label_observed"] === true;
    assert.equal(
      deployment["renma.deployment.commit"],
      (isB ? git.boundB : git.boundA).sourceRevision.commit,
    );
    assert.equal(
      deployment["renma.deployment.content_digest"],
      isB ? catalog.digests.b : catalog.digests.a,
    );
    assert.equal(provider["renma.provenance"], "synthetic-provider-projection");
    assert.equal(deployment["renma.provenance"], "experiment-wrapper");
    assert.equal(
      deployment["renma.deployment.injected_revision"],
      "unsupported",
    );
    assert.equal(provider["renma.deployment.commit"], undefined);
  }
  // Confirm that the independent schema checker actually rejects a wrong type.
  assert.notEqual(
    request.verify({
      resourceLogs: [
        {
          scopeLogs: [
            {
              logRecords: [
                {
                  body: { boolValue: "not-a-boolean" },
                },
              ],
            },
          ],
        },
      ],
    }),
    null,
  );
});
