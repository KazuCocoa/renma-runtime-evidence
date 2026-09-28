import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { summarize, SKILLS } from "../src/collector.js";

test("two saved real reports independently support the declared observation and delta-count result", async () => {
  for (const run of [1, 2]) {
    const r = JSON.parse(
      await readFile(
        `experiments/codex-plugin-usage/results/20260927-cli-0.157.1-run-${run}.json`,
        "utf8",
      ),
    );
    assert.equal(r.evidenceClass, "real-cli-on-synthetic-plugin");
    assert.equal(r.collectorStartedByPluginMcp, true);
    assert.equal(r.turns.length, 5);
    assert.ok(
      r.turns.every((t: { status: string }) => t.status === "completed"),
    );
    assert.equal(r.listing.length, 3);
    assert.ok(
      r.listing.every(
        (s: {
          enabled: boolean;
          pluginOwnerVerified: boolean;
          installedPathVerified: boolean;
        }) => s.enabled && s.pluginOwnerVerified && s.installedPathVerified,
      ),
    );
    assert.equal(r.telemetry.rejectedRequests, 0);
    assert.equal(r.telemetry.unknownSkillObserved, false);
    assert.deepEqual(summarize(r.telemetry.samples), r.telemetry.skills);
    assert.deepEqual(
      r.telemetry.skills.map(
        (s: { providerCounterTotal: number | null }) => s.providerCounterTotal,
      ),
      [3, 1, null],
    );
    assert.equal(r.telemetry.samples.length, 4);
    const begin = Date.parse(r.turns[0].startedAt),
      end = Date.parse(r.turns.at(-1).completedAt) + 10000;
    for (const s of r.telemetry.samples) {
      assert.ok(SKILLS.includes(s.skill));
      assert.equal(s.providerSkill, `renma-usage-fixture_${s.skill}`);
      assert.equal(s.aggregation, "delta");
      assert.equal(s.value, 1);
      assert.ok(s.observedAt.endsWith("Z"));
      assert.ok(Date.parse(s.observedAt) >= begin);
      assert.ok(Date.parse(s.observedAt) <= end);
      assert.deepEqual(
        Object.keys(s).sort(),
        [
          "skill",
          "providerSkill",
          "observedAt",
          "elapsedMs",
          "value",
          "aggregation",
          "monotonic",
          "startTimeUnixNano",
          "timeUnixNano",
          "extraDimensions",
          "dimensions",
          "unsupportedDimensionKinds",
        ].sort(),
      );
    }
    assert.deepEqual(
      new Set(r.manifest.map((m: { repositoryId: string }) => m.repositoryId)),
      new Set(["fixture-repository-a", "fixture-repository-b"]),
    );
  }
});

test("saved lifecycle failure remains distinct from successful HTTP usage collection", async () => {
  const r = JSON.parse(
    await readFile(
      "experiments/codex-plugin-usage/results/20260927-cli-0.157.1-lifecycle.json",
      "utf8",
    ),
  );
  assert.deepEqual(summarize(r.telemetry.samples), r.telemetry.skills);
  assert.deepEqual(
    r.receiverStates.map((s: { state: string }) => s.state),
    ["connected", "failed"],
  );
  assert.ok(
    r.receiverStates.every(
      (s: { toolsErrorObserved: boolean }) => s.toolsErrorObserved,
    ),
  );
  assert.equal(r.receiverStartupFailure, "address-in-use");
  assert.deepEqual(
    r.telemetry.skills.map(
      (s: { providerCounterTotal: number | null }) => s.providerCounterTotal,
    ),
    [3, 1, null],
  );
});

test("saved shared receiver run verifies both thread connections and survival after Codex exits", async () => {
  const r = JSON.parse(
    await readFile(
      "experiments/codex-plugin-usage/results/20260928-cli-0.157.1-shared.json",
      "utf8",
    ),
  );
  assert.equal(r.evidenceClass, "real-cli-on-synthetic-plugin");
  assert.equal(r.collectorStartedByPluginMcp, false);
  assert.equal(r.collectorOwner, "experiment-wrapper");
  assert.equal(r.sharedReceiverSurvivedCodexShutdown, true);
  assert.equal(r.receiverStartupFailure, "not-observed");
  assert.deepEqual(
    r.receiverStates.map((s: { state: string }) => s.state),
    ["connected", "connected"],
  );
  assert.ok(
    r.receiverStates.every(
      (s: { fixtureServerIdentified: boolean; toolsErrorObserved: boolean }) =>
        s.fixtureServerIdentified && !s.toolsErrorObserved,
    ),
  );
  assert.equal(r.turns.length, 5);
  assert.ok(r.turns.every((t: { status: string }) => t.status === "completed"));
  assert.equal(r.telemetry.rejectedRequests, 0);
  assert.deepEqual(summarize(r.telemetry.samples), r.telemetry.skills);
  assert.deepEqual(
    r.telemetry.skills.map(
      (s: { providerCounterTotal: number | null }) => s.providerCounterTotal,
    ),
    [3, 1, null],
  );
});
