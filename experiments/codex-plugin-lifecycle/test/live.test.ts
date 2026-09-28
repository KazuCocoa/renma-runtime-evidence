import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  summarize,
  type Sample,
} from "../../codex-plugin-usage/src/collector.js";

type Turn = {
  scenario: string;
  requestedSkill: string;
  status: string;
  startedAt: string;
  observedThrough: string;
  sampleStartIndex: number;
  sampleEndIndex: number;
  receiverHealthy: boolean;
};

for (const name of [
  "20260928-live-thread-start.json",
  "20260928-live-primed.json",
]) {
  test(`saved live lifecycle observations retain bounded receipt evidence: ${name}`, async () => {
    const report = JSON.parse(
      await readFile(
        `experiments/codex-plugin-lifecycle/results/${name}`,
        "utf8",
      ),
    );
    const samples: Sample[] = report.collector.samples;
    const turns: Turn[] = report.turns;
    assert.equal(report.authentication, "existing-chatgpt-file-login");
    assert.equal(report.analyticsEnabled, true);
    assert.equal(report.selectionMode, "text-name-only-no-explicit-skill-path");
    assert.equal(report.producerEpochs, 1);
    assert.equal(report.receiverEpochs, 1);
    assert.equal(report.exporterEndpointTextPreserved, true);
    assert.equal(report.collector.rejectedRequests, 0);
    assert.equal(report.collector.unknownSkillObserved, false);
    assert.equal(turns.length, 9);
    assert.ok(
      turns.every((t) => t.status === "completed" && t.receiverHealthy),
    );
    const noReceipt = new Set([
      "disabled-new-thread",
      "removed-existing-unused-thread",
      "removed-new-thread",
    ]);
    for (const turn of turns) {
      const received = samples.slice(
        turn.sampleStartIndex,
        turn.sampleEndIndex,
      );
      assert.equal(received.length, noReceipt.has(turn.scenario) ? 0 : 1);
      for (const sample of received) {
        assert.equal(sample.skill, turn.requestedSkill);
        assert.equal(sample.value, 1);
        assert.equal(sample.aggregation, "delta");
        assert.ok(Date.parse(sample.observedAt) >= Date.parse(turn.startedAt));
        assert.ok(
          Date.parse(sample.observedAt) <= Date.parse(turn.observedThrough),
        );
      }
      // A no-receipt window is never converted into a zero usage measurement.
      if (noReceipt.has(turn.scenario))
        assert.ok(
          summarize(received).every((s) => s.providerCounterTotal === null),
        );
    }
    assert.equal(samples.length, 6);
    assert.equal(report.beforeShutdownSampleCount, samples.length);
    assert.deepEqual(
      report.collector.skills.map(
        (s: { providerCounterTotal: number | null }) => s.providerCounterTotal,
      ),
      [3, 3, null],
    );
    const phase = (name: string) =>
      report.transitions.find((t: { phase: string }) => t.phase === name);
    assert.equal(phase("disabled").configuration.pluginEnabled, false);
    assert.ok(
      phase("disabled").skills.every(
        (s: { entries: number }) => s.entries === 0,
      ),
    );
    assert.equal(phase("reenabled").configuration.pluginEnabled, true);
    assert.equal(phase("updated").originalCacheExists, false);
    assert.equal(phase("removed").plugin.installed, false);
    assert.equal(phase("removed").updatedCacheExists, false);
    assert.equal(report.limits.injectedRevision, "unsupported");
    assert.equal(report.limits.noSample, "unknown-not-zero");
  });
}

test("neutral priming adds no target samples and no-receipt turns still receive OTLP requests", async () => {
  const report = JSON.parse(
    await readFile(
      "experiments/codex-plugin-lifecycle/results/20260928-live-primed.json",
      "utf8",
    ),
  );
  assert.equal(
    report.existingThreadPreparation,
    "completed-neutral-turn-no-skill-request",
  );
  assert.equal(report.primingTurns.length, 3);
  assert.ok(
    report.primingTurns.every(
      (t: Turn) =>
        t.status === "completed" && t.sampleStartIndex === t.sampleEndIndex,
    ),
  );
  assert.ok(
    report.turns.every(
      (t: {
        receivedRequestsBefore: number;
        receivedRequestsAfter: number;
        rejectedRequestsAfter: number;
      }) =>
        t.receivedRequestsAfter > t.receivedRequestsBefore &&
        t.rejectedRequestsAfter === 0,
    ),
  );
});
