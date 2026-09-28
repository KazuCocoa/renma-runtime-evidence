import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { observation } from "../src/record.js";
const report = async (name: string) =>
  JSON.parse(
    await readFile(
      `experiments/local-telemetry-system/results/${name}.json`,
      "utf8",
    ),
  );

test("saved compatibility evidence accounts for all ten reserved model turns", async () => {
  let turns = 0;
  for (const [mode, version, os, count] of [
    ["current", "codex-cli 0.157.1", "darwin", 6],
    ["previous", "codex-cli 0.156.0", "darwin", 2],
    ["docker", "codex-cli 0.157.1", "linux", 2],
  ] as const) {
    const r = (await report(`20260928-integration-${mode}`)).integration;
    assert.equal(r.version, version);
    assert.equal(r.operatingSystem, os);
    assert.equal(r.architecture, "arm64");
    assert.equal(r.modelTurns, count);
    assert.equal(r.backend.records.length, count);
    assert.equal(r.unprojectableSamples, 0);
    assert.equal(r.queue.pending, 0);
    assert.equal(r.installedPackageDigestsVerified, true);
    assert.equal(r.exporterEndpointTextPreserved, true);
    assert.ok(
      r.turns.every((t: { status: string }) => t.status === "completed"),
    );
    for (const row of r.backend.records)
      assert.deepEqual(observation(row), row);
    if (mode === "current") {
      assert.equal(r.secondHome.sameMcpConfiguration, true);
      assert.equal(r.secondHome.mcp.connected, true);
      assert.deepEqual(
        r.resolution.map((v: { state: string }) => v.state),
        [
          "unique-deployment",
          "unique-deployment",
          "equivalent-content",
          "ambiguous-content",
          "ambiguous-content",
          "modified-deployment",
        ],
      );
    }
    turns += count;
  }
  const ledger = await report("model-turn-ledger");
  assert.equal(turns, 10);
  assert.equal(ledger.attempts.length, turns);
  assert.equal(ledger.limit, 60);
});

test("saved path/removal and Collector fault results retain negative controls", async () => {
  const paths = await report("20260928-plugin-paths");
  assert.equal(paths.modelTurns, 0);
  assert.equal(paths.removal.freshPluginServers, 0);
  assert.equal(paths.removal.sharedCollectorStillHealthy, true);
  assert.deepEqual(
    paths.states
      .filter((s: { runtimeStatus: string }) => s.runtimeStatus === "connected")
      .map((s: { variant: string }) => s.variant),
    ["absolute-control", "inline-module"],
  );
  const delivery = await report("20260928-delivery");
  assert.equal(delivery.collector.baselineReceived, true);
  assert.equal(delivery.collector.recovered, true);
  assert.equal(delivery.collector.beforeKillStatus, 200);
  assert.equal(delivery.collector.afterCollectorRestart, 4);
  assert.equal(delivery.collector.finalBackendRecords, 5);
  assert.equal(delivery.backend.duplicates, 1);
  assert.equal(delivery.backend.unauthorized, 1);
});
