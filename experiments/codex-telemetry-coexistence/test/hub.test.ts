import test from "node:test";
import assert from "node:assert/strict";
import { createHub } from "../src/hub.js";
const packet = (skill = "renma-usage-alpha", value = 1) => ({
  resourceMetrics: [
    {
      resource: {
        attributes: [
          { key: "private", value: { stringValue: "NEVER_RETAIN" } },
        ],
      },
      scopeMetrics: [
        {
          metrics: [
            {
              name: "codex.skill.injected",
              sum: {
                aggregationTemporality: 1,
                isMonotonic: true,
                dataPoints: [
                  {
                    asInt: value,
                    startTimeUnixNano: "1",
                    timeUnixNano: "2",
                    attributes: [
                      { key: "skill", value: { stringValue: skill } },
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
});

test("dedicated routes separate identical concurrent producer series and consumer views", async () => {
  const hub = await createHub("alpha");
  const send = async (path: string, body?: unknown) => {
    const r = await fetch(hub.base + path, {
      method: "POST",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    await r.body?.cancel();
    return r.status;
  };
  try {
    assert.equal(await send("/start/first/beta"), 425);
    assert.equal(await send("/start/first/alpha"), 200);
    assert.equal(await send("/start/first/beta"), 200);
    await Promise.all([
      send("/metrics/first", packet()),
      send("/metrics/second", packet()),
    ]);
    assert.deepEqual(
      hub.snapshot().producers.map((p) => p.skills[0]!.providerCounterTotal),
      [1, 1, null],
    );
    assert.deepEqual(
      await fetch(hub.base + "/view/first/alpha").then((r) => r.json()),
      { sampleCount: 1 },
    );
    assert.deepEqual(
      await fetch(hub.base + "/view/first/beta").then((r) => r.json()),
      { sampleCount: 0 },
    );
    assert.equal(await send("/ack/first/alpha/1"), 200);
    assert.equal(await send("/ack/first/alpha/1"), 200);
    assert.equal(await send("/ack/first/beta/1"), 400);
    assert.equal(hub.snapshot().producers[0]!.acknowledged.alpha, 1);
    assert.equal(
      hub.snapshot().producers[0]!.skills[0]!.providerCounterTotal,
      1,
    );
    assert.equal(await send("/metrics/unknown", packet()), 404);
    assert.equal(
      JSON.stringify(hub.snapshot()).includes("NEVER_RETAIN"),
      false,
    );
    assert.equal(await send("/stop/first/alpha"), 200);
    assert.equal(
      await send("/metrics/second", packet("renma-usage-beta")),
      200,
    );
    assert.equal(
      hub.snapshot().producers[1]!.skills[1]!.providerCounterTotal,
      1,
    );
  } finally {
    await hub.close();
  }
});

test("synthetic replay deduplication does not silently turn uncertain series into usage totals", async () => {
  const hub = await createHub("beta");
  try {
    for (let i = 0; i < 2; i++) {
      const r = await fetch(hub.base + "/metrics/first", {
        method: "POST",
        body: JSON.stringify(packet()),
      });
      await r.body?.cancel();
    }
    assert.equal(hub.snapshot().producers[0]!.samples.length, 2);
    assert.equal(
      hub.snapshot().producers[0]!.skills[0]!.providerCounterTotal,
      1,
    );
    const r = await fetch(hub.base + "/metrics/first", {
      method: "POST",
      body: JSON.stringify(packet("renma-usage-alpha", 2)),
    });
    await r.body?.cancel();
    assert.equal(
      hub.snapshot().producers[0]!.skills[0]!.providerCounterTotal,
      null,
    );
    assert.equal(
      hub.snapshot().producers[0]!.skills[0]!.countStatus,
      "unsupported-series",
    );
  } finally {
    await hub.close();
  }
});

test("deliberate 503 keeps reduced failure evidence outside accepted usage, then permits recovery", async () => {
  const hub = await createHub("alpha");
  try {
    hub.setAccepting(false);
    const fail = await fetch(hub.base + "/metrics/first", {
      method: "POST",
      body: JSON.stringify(packet()),
    });
    await fail.body?.cancel();
    assert.equal(fail.status, 503);
    assert.equal(hub.snapshot().producers[0]!.samples.length, 0);
    assert.equal(hub.snapshot().failedExports[0]!.samples.length, 1);
    assert.ok(!JSON.stringify(hub.snapshot()).includes("NEVER_RETAIN"));
    hub.setAccepting(true);
    const success = await fetch(hub.base + "/metrics/first", {
      method: "POST",
      body: JSON.stringify(packet()),
    });
    await success.body?.cancel();
    assert.equal(success.status, 200);
    assert.equal(
      hub.snapshot().producers[0]!.skills[0]!.providerCounterTotal,
      1,
    );
  } finally {
    await hub.close();
  }
});
