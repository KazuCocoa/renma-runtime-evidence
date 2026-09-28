import test from "node:test";
import assert from "node:assert/strict";
import { analyzeTiming } from "../src/timing.js";
import type { Sample } from "../../codex-plugin-usage/src/collector.js";
const sample = (observedAt: string, elapsedMs: number): Sample => ({
  skill: "renma-usage-alpha",
  providerSkill: "renma-usage-alpha",
  observedAt,
  elapsedMs,
  value: 1,
  aggregation: "delta",
  monotonic: true,
  startTimeUnixNano: "1000000000",
  timeUnixNano: "2000000000",
  extraDimensions: false,
  dimensions: {},
  unsupportedDimensionKinds: [],
});
test("synthetic clock regression is visible while monotonic receipt order remains available", () => {
  const r = analyzeTiming([
    sample("1970-01-01T00:00:01.000Z", 2000),
    sample("1970-01-01T00:00:03.000Z", 1000),
  ]);
  assert.equal(r.receiverUtcRegressions, 1);
  assert.deepEqual(r.providerIntervalEndToReceiptMs, { min: -1000, max: 1000 });
  assert.equal(r.exactInjectionTime, "unsupported");
});
test("batch timestamps do not establish individual Skill injection order", () => {
  const r = analyzeTiming([
    sample("1970-01-01T00:00:03.000Z", 1000),
    sample("1970-01-01T00:00:03.000Z", 1000),
  ]);
  assert.equal(r.sharedReceiptTimestampObserved, true);
  assert.equal(analyzeTiming([]).providerIntervalEndToReceiptMs, null);
});
