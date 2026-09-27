import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import protobuf from "protobufjs";
import { LISTING_FIXTURE_NAME } from "../../codex-listing-freshness/src/listing.js";
import { barrierDeployment } from "../src/barrier.js";
import { bindRuntimeOtelProjection } from "../src/runtime-otel.js";

const presence = {
  schemaVersion: 1,
  provider: "codex",
  signal: "skill-injected",
  observationScope: "collector-lifetime",
  injectedSkills: [LISTING_FIXTURE_NAME],
  unrecognizedSkillObserved: false,
};
type Packet = ReturnType<
  ReturnType<typeof bindRuntimeOtelProjection>["project"]
>;
function attributes(packet: Packet, group: number) {
  return Object.fromEntries(
    packet.resourceLogs[0]!.scopeLogs[0]!.logRecords[0]!.body.kvlistValue.values[
      group
    ]!.value.kvlistValue.values.map(({ key, value }) => [
      key,
      "stringValue" in value ? value.stringValue : value.boolValue,
    ]),
  );
}

function requestType() {
  const vendor = resolve(
    "experiments/deployment-snapshot/vendor/opentelemetry-proto",
  );
  const metadata = JSON.parse(
    readFileSync(resolve(vendor, "UPSTREAM.json"), "utf8"),
  );
  const root = new protobuf.Root();
  root.resolvePath = (_origin, target) => {
    if (!Object.hasOwn(metadata.sha256, target) || !target.endsWith(".proto"))
      throw new Error("Unrecognized schema import");
    return resolve(vendor, target);
  };
  root.loadSync("opentelemetry/proto/collector/logs/v1/logs_service.proto");
  return root.lookupType(
    "opentelemetry.proto.collector.logs.v1.ExportLogsServiceRequest",
  );
}

test("runtime OTLP freezes known wrapper state and never upgrades it to a provider revision", () => {
  const input = { ...barrierDeployment("a"), secret: "PRIVATE_MANIFEST" };
  const bound = bindRuntimeOtelProjection(input, "synthetic-test");
  input.digest = barrierDeployment("b").digest;
  input.revision = "b";
  const packet = bound.project({ ...presence, secret: "PRIVATE_PROMPT" });
  const provider = attributes(packet, 0);
  const wrapper = attributes(packet, 1);
  assert.equal(provider["renma.provenance"], "synthetic-provider-projection");
  assert.equal(provider["renma.provider.presence_observed"], true);
  assert.equal(
    wrapper["renma.deployment.content_digest"],
    barrierDeployment("a").digest,
  );
  assert.equal(wrapper["renma.deployment.fixture_revision"], "a");
  assert.equal(wrapper["renma.deployment.injected_revision"], "unsupported");
  assert.ok(
    Object.keys(provider).every((key) => !key.startsWith("renma.deployment.")),
  );
  assert.ok(
    Object.keys(wrapper).every((key) => !key.startsWith("renma.provider.")),
  );
  assert.equal(JSON.stringify(packet).includes("PRIVATE"), false);
  packet.resourceLogs.pop();
  assert.equal(
    attributes(bound.project(presence), 1)["renma.deployment.fixture_revision"],
    "a",
  );
});

test("absent presence suppresses the candidate digest and unknown labels become a boolean", () => {
  const bound = bindRuntimeOtelProjection(
    barrierDeployment("a"),
    "synthetic-test",
  );
  const packet = bound.project({
    ...presence,
    injectedSkills: ["PRIVATE_LABEL"],
  });
  assert.equal(
    attributes(packet, 0)["renma.provider.unrecognized_label_observed"],
    true,
  );
  assert.equal(
    attributes(packet, 1)["renma.deployment.content_digest"],
    undefined,
  );
  assert.equal(
    attributes(packet, 1)["renma.deployment.fixture_revision"],
    undefined,
  );
  assert.equal(JSON.stringify(packet).includes("PRIVATE"), false);
  for (const changes of [
    { schemaVersion: 2 },
    { provider: "other" },
    { signal: "executed" },
    { observationScope: "turn" },
    { injectedSkills: [null] },
    { unrecognizedSkillObserved: "false" },
  ])
    assert.throws(() => bound.project({ ...presence, ...changes }));
  assert.throws(() =>
    bindRuntimeOtelProjection(
      { ...barrierDeployment("a"), digest: "PRIVATE_DIGEST" },
      "synthetic-test",
    ),
  );
});

test("pinned protobuf schema preserves the paired experimental runtime projection exactly", () => {
  const request = requestType();
  const packet = bindRuntimeOtelProjection(
    barrierDeployment("a"),
    "synthetic-test",
  ).project(presence);
  assert.equal(request.verify(packet), null);
  assert.deepEqual(
    request.toObject(
      request.decode(request.encode(request.fromObject(packet)).finish()),
      { longs: String, defaults: false },
    ),
    packet,
  );
  const record = packet.resourceLogs[0]!.scopeLogs[0]!.logRecords[0]!;
  assert.deepEqual(
    record.body.kvlistValue.values.map(({ key }) => key),
    ["provider", "deployment"],
  );
});

test("committed real reduced records decode without replacing bound A with the later B state", () => {
  for (const filename of [
    "20260927-cli-0.157.1-runtime-otel.json",
    "20260927-cli-0.157.1-git-transport.json",
  ]) {
    const report = JSON.parse(
      readFileSync(
        resolve(`experiments/codex-model-freshness/results/${filename}`),
        "utf8",
      ),
    );
    const request = requestType();
    assert.equal(report.rows.length, 2);
    for (const row of report.rows) {
      const packet: Packet = row.runtimeOtel;
      assert.equal(request.verify(packet), null);
      assert.deepEqual(
        request.toObject(
          request.decode(request.encode(request.fromObject(packet)).finish()),
          { longs: String, defaults: false },
        ),
        packet,
      );
      const provider = attributes(packet, 0);
      const wrapper = attributes(packet, 1);
      assert.equal(provider["renma.provenance"], "provider-runtime-reduction");
      assert.equal(
        wrapper["renma.deployment.injected_revision"],
        "unsupported",
      );
      assert.equal(row.modelTurn.status, "completed");
      if (row.scenario === "direct-tool") {
        assert.equal(provider["renma.provider.presence_observed"], false);
        assert.equal(wrapper["renma.deployment.content_digest"], undefined);
      } else {
        assert.equal(row.scenario, "skill-midturn");
        assert.equal(row.finalDeployment.revision, "b");
        assert.equal(row.wrapperBarrier.replacementVerifiedBeforeReply, true);
        assert.equal(provider["renma.provider.presence_observed"], true);
        assert.equal(
          wrapper["renma.deployment.content_digest"],
          barrierDeployment("a").digest,
        );
        assert.equal(wrapper["renma.deployment.fixture_revision"], "a");
        assert.equal(provider["renma.deployment.content_digest"], undefined);
        if (row.fixtureGit) {
          assert.notEqual(
            row.fixtureGit.initial.commit,
            row.fixtureGit.latest.commit,
          );
          assert.equal(
            wrapper["renma.deployment.commit"],
            row.fixtureGit.initial.commit,
          );
          assert.equal(provider["renma.deployment.commit"], undefined);
          assert.equal(row.transport.exactReducedPacketReceived, true);
        }
      }
    }
  }
});
