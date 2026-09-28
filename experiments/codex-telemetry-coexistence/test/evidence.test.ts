import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { summarize } from "../../codex-plugin-usage/src/collector.js";

test("real cooperative plugin runs preserve source boundaries, both attach orders, and shutdown survival", async () => {
  for (const [name, order, secondAlpha] of [
    ["alpha-first-same-thread", "alpha", 1],
    ["beta-first-new-thread", "beta", 2],
  ] as const) {
    const r = JSON.parse(
      await readFile(
        `experiments/codex-telemetry-coexistence/results/20260928-${name}.json`,
        "utf8",
      ),
    );
    assert.equal(r.evidenceClass, "real-cli-two-synthetic-plugins");
    assert.equal(r.exporterEndpointTextPreserved, true);
    assert.equal(r.exporterConfiguredBeforePluginInstall, true);
    assert.equal(r.hubSurvivedFirstExit, true);
    assert.equal(r.turns.length, 5);
    assert.ok(
      r.turns.every((t: { status: string }) => t.status === "completed"),
    );
    assert.ok(
      r.connections
        .flat()
        .every(
          (c: {
            connected: boolean;
            knownServer: boolean;
            toolsErrorObserved: boolean;
          }) => c.connected && c.knownServer && !c.toolsErrorObserved,
        ),
    );
    assert.equal(r.telemetry.rejected, 0);
    assert.equal(r.telemetry.unknownSkillObserved, false);
    for (const p of r.telemetry.producers) {
      assert.deepEqual(summarize(p.samples), p.skills);
      if (p.producer === "restarted") {
        assert.equal(p.samples.length, 0);
        continue;
      }
      const first = r.telemetry.events.find(
        (e: { producer: string; action: string }) =>
          e.producer === p.producer && e.action === "start",
      );
      assert.equal(first.consumer, order);
      const expectedAlpha = p.producer === "first" ? 1 : secondAlpha;
      assert.deepEqual(
        p.skills.map(
          (s: { providerCounterTotal: number | null }) =>
            s.providerCounterTotal,
        ),
        [expectedAlpha, 1, null],
      );
      assert.deepEqual(p.acknowledged, { alpha: expectedAlpha, beta: 1 });
    }
    if (order === "beta") {
      const exit = r.telemetry.events
        .filter(
          (e: { producer: string; action: string }) =>
            e.producer === "first" && e.action === "stop",
        )
        .at(-1);
      assert.ok(
        r.telemetry.producers[1].samples.some(
          (s: { observedAt: string }) =>
            Date.parse(s.observedAt) > Date.parse(exit.observedAt),
        ),
      );
    }
  }
});

test("failed duplicate-key run stays a failure despite successful model turns and metrics", async () => {
  const r = JSON.parse(
    await readFile(
      "experiments/codex-telemetry-coexistence/results/20260928-duplicate-mcp-key.json",
      "utf8",
    ),
  );
  assert.equal(r.telemetry.events.length, 0);
  assert.ok(
    r.connections.flat().some((c: { connected: boolean }) => !c.connected),
  );
  assert.ok(r.telemetry.producers[0].samples.length > 0);
  assert.deepEqual(r.telemetry.producers[0].acknowledged, {
    alpha: 0,
    beta: 0,
  });
});
