import test from "node:test";
import assert from "node:assert/strict";
import {
  createUsageCollector,
  reduceMetrics,
  summarize,
} from "../src/collector.js";

const time = "2026-09-27T22:00:00.000Z";
function payload(value: unknown = 1, extra: Record<string, unknown> = {}) {
  return {
    resourceMetrics: [
      {
        resource: {
          attributes: [{ key: "private", value: { stringValue: "SECRET" } }],
        },
        scopeMetrics: [
          {
            metrics: [
              {
                name: "codex.skill.injected",
                sum: {
                  aggregationTemporality: 2,
                  isMonotonic: true,
                  dataPoints: [
                    {
                      attributes: [
                        {
                          key: "skill",
                          value: { stringValue: "renma-usage-alpha" },
                        },
                        { key: "status", value: { stringValue: "ok" } },
                      ],
                      asInt: value,
                      startTimeUnixNano: "1000000000",
                      timeUnixNano: "2000000000",
                      ...extra,
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    ],
  };
}
test("receipt clock, finite provider metadata and explicit value survive; content does not", () => {
  const sample = reduceMetrics(payload(3), time, 12).samples[0]!;
  assert.equal(sample.observedAt, time);
  assert.equal(sample.elapsedMs, 12);
  assert.equal(sample.value, 3);
  assert.equal(JSON.stringify(sample).includes("SECRET"), false);
  assert.equal(summarize([sample])[0]!.providerCounterTotal, 3);
  assert.equal(summarize([sample])[0]!.injectionTime, "unsupported");
});
test("cumulative repeats are not counted twice; increases have observation times", () => {
  const a = reduceMetrics(payload(1), time, 0).samples[0]!;
  const repeat = {
    ...a,
    observedAt: "2026-09-27T22:00:01.000Z",
    timeUnixNano: "3000000000",
  };
  const b = {
    ...repeat,
    value: 3,
    observedAt: "2026-09-27T22:00:02.000Z",
    timeUnixNano: "4000000000",
  };
  const [summary] = summarize([a, repeat, b]);
  assert.equal(summary!.providerCounterTotal, 3);
  assert.equal(summary!.receivedSamples, 3);
  assert.equal(summary!.firstObservedAt, time);
  assert.equal(summary!.lastIncreaseObservedAt, b.observedAt);
  assert.equal(summarize([a, repeat])[0]!.lastIncreaseObservedAt, time);
});
test("reset, decrease, delta, missing epoch, extra dimensions and conflicting timestamps fail count attribution", () => {
  const a = reduceMetrics(payload(), time, 0).samples[0]!;
  for (const bad of [
    { ...a, startTimeUnixNano: "1500000000" },
    { ...a, value: 0, timeUnixNano: "3000000000" },
    { ...a, aggregation: "delta" as const },
    { ...a, startTimeUnixNano: null },
    { ...a, extraDimensions: true },
    { ...a, value: 2 },
  ]) {
    assert.equal(summarize([a, bad])[0]!.providerCounterTotal, null);
  }
  assert.equal(summarize([])[0]!.countStatus, "no-sample");
  assert.equal(summarize([])[0]!.providerCounterTotal, null);
});
test("invalid and unknown fields never become evidence", () => {
  for (const value of [
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    "SECRET",
    {},
    null,
  ])
    assert.throws(() => reduceMetrics(payload(value), time, 0));
  assert.throws(() => reduceMetrics(payload(1, { asDouble: 2 }), time, 0));
  const unknown = payload(1, {
    attributes: [
      { key: "skill", value: { stringValue: "SECRET" } },
      { key: "status", value: { stringValue: "ok" } },
    ],
  });
  const reduced = reduceMetrics(unknown, time, 0);
  assert.equal(reduced.unknownSkillObserved, true);
  assert.equal(JSON.stringify(reduced).includes("SECRET"), false);
  assert.equal(
    reduceMetrics(payload(1, { flags: 1 }), time, 0).samples.length,
    0,
  );
});
test("HTTP collector retains real UTC receipts and atomically rejects malformed requests", async () => {
  const c = await createUsageCollector();
  try {
    const before = Date.now();
    const sent = await fetch(c.endpoint, {
      method: "POST",
      body: JSON.stringify(payload(2)),
    });
    await sent.body?.cancel();
    assert.equal(sent.status, 200);
    const malformed = payload(4);
    malformed.resourceMetrics[0]!.scopeMetrics[0]!.metrics.push({
      name: "codex.skill.injected",
      sum: {
        aggregationTemporality: 2,
        isMonotonic: true,
        dataPoints: [
          {
            attributes: [],
            asInt: 4,
            startTimeUnixNano: "1",
            timeUnixNano: "2",
          },
        ],
      },
    });
    const rejected = await fetch(c.endpoint, {
      method: "POST",
      body: JSON.stringify(malformed),
    });
    await rejected.body?.cancel();
    assert.equal(rejected.status, 400);
    const report = c.snapshot();
    assert.equal(report.samples.length, 1);
    assert.equal(report.rejectedRequests, 1);
    assert.ok(Date.parse(report.samples[0]!.observedAt) >= before);
    assert.ok(Date.parse(report.samples[0]!.observedAt) <= Date.now());
    report.samples[0]!.value = 100;
    assert.equal(c.snapshot().samples[0]!.value, 2);
  } finally {
    await c.close();
  }
});

test("plugin metric underscore label maps explicitly and keeps provider spelling", () => {
  const r = reduceMetrics(
    payload(2, {
      attributes: [
        {
          key: "skill",
          value: { stringValue: "renma-usage-fixture_renma-usage-alpha" },
        },
        { key: "status", value: { stringValue: "ok" } },
      ],
    }),
    time,
    0,
  );
  assert.equal(r.samples[0]!.skill, "renma-usage-alpha");
  assert.equal(
    r.samples[0]!.providerSkill,
    "renma-usage-fixture_renma-usage-alpha",
  );
  assert.equal(r.unknownSkillObserved, false);
});
test("same-label resource/scope points do not merge into a usage total", () => {
  const p = payload(1);
  p.resourceMetrics.push(payload(2).resourceMetrics[0]!);
  const r = reduceMetrics(p, time, 0);
  assert.ok(r.samples.every((s) => s.extraDimensions));
  assert.equal(summarize(r.samples)[0]!.providerCounterTotal, null);
});

test("delta samples sum disjoint intervals, deduplicate retries and preserve receipt recency", () => {
  const base = reduceMetrics(payload(1), time, 0).samples[0]!;
  const a = { ...base, aggregation: "delta" as const };
  const b = {
    ...a,
    startTimeUnixNano: "3000000000",
    timeUnixNano: "4000000000",
    value: 2,
    observedAt: "2026-09-27T22:00:02.000Z",
  };
  const replay = { ...a, observedAt: "2026-09-27T22:00:03.000Z" };
  const summary = summarize([a, b, replay])[0]!;
  assert.equal(summary.providerCounterTotal, 3);
  assert.equal(summary.countStatus, "single-producer-deduplicated-delta-sum");
  assert.equal(summary.deltaIntervalGapsObserved, true);
  assert.equal(summary.lastIncreaseObservedAt, b.observedAt);
  assert.equal(summary.lastReceivedAt, replay.observedAt);
  assert.equal(summary.coverage, "received-samples-only");
  for (const c of [
    { ...a, value: 2 },
    { ...a, startTimeUnixNano: "1500000000", timeUnixNano: "2500000000" },
  ])
    assert.equal(summarize([a, c])[0]!.providerCounterTotal, null);
});
test("only explicitly declared provider metadata participates in series identity", () => {
  const attrs = [
    { key: "skill", value: { stringValue: "renma-usage-alpha" } },
    { key: "status", value: { stringValue: "ok" } },
    { key: "model", value: { stringValue: "gpt-6-sol" } },
    { key: "originator", value: { stringValue: "renma_usage_fixture" } },
  ];
  const s = reduceMetrics(payload(1, { attributes: attrs }), time, 0)
    .samples[0]!;
  assert.equal(s.extraDimensions, false);
  assert.equal(s.dimensions.model, "gpt-6-sol");
  const unknown = reduceMetrics(
    payload(1, {
      attributes: [
        ...attrs,
        { key: "user.email", value: { stringValue: "SECRET" } },
      ],
    }),
    time,
    0,
  );
  assert.equal(JSON.stringify(unknown).includes("SECRET"), false);
  assert.equal(JSON.stringify(unknown).includes("user.email"), false);
  assert.equal(unknown.samples[0]!.extraDimensions, true);
});

test("disjoint delta intervals can aggregate over omitted dimensions; ambiguous duplicates cannot", () => {
  const s = reduceMetrics(payload(1), time, 0).samples[0]!;
  const a = { ...s, aggregation: "delta" as const, extraDimensions: true };
  const b = {
    ...a,
    startTimeUnixNano: "3000000000",
    timeUnixNano: "4000000000",
  };
  assert.equal(summarize([a, b])[0]!.providerCounterTotal, 2);
  assert.equal(
    summarize([a, b])[0]!.countStatus,
    "single-producer-disjoint-delta-sum",
  );
  assert.equal(summarize([a, b, a])[0]!.providerCounterTotal, null);
});
