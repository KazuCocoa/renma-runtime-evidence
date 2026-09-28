import test from "node:test";
import assert from "node:assert/strict";
import { reduceConfig, reducePlugins } from "../src/state.js";
import { createProbe } from "../src/probe.js";

test("lifecycle config and marketplace reducers discard non-allowlisted data", () => {
  const name = "renma-usage-fixture";
  assert.deepEqual(
    reduceConfig({
      config: {
        instructions: "SECRET",
        plugins: {
          [`${name}@personal`]: { enabled: false, secret: "SECRET" },
          [`"${name}@personal"`]: { enabled: true },
          other: { enabled: true },
        },
      },
      origins: "SECRET",
    }),
    { pluginEnabled: false, literalQuotedPluginEnabled: true },
  );
  assert.deepEqual(
    reduceConfig({
      config: { plugins: { [`${name}@personal`]: { enabled: "false" } } },
    }),
    { pluginEnabled: null, literalQuotedPluginEnabled: null },
  );
  const plugin = {
    name,
    installed: true,
    enabled: false,
    instructions: "SECRET",
    source: "SECRET",
  };
  assert.deepEqual(
    reducePlugins({
      marketplaces: [
        { name: "other", plugins: [plugin] },
        { name: "personal", plugins: [plugin] },
      ],
      secret: "SECRET",
    }),
    { entries: 1, installed: true, enabled: false },
  );
  assert.deepEqual(
    reducePlugins({
      marketplaces: [{ name: "personal", plugins: [plugin, plugin] }],
    }),
    { entries: 2, installed: null, enabled: null },
  );
});

test("fixture process probe rejects unknown labels and distinguishes heartbeat from stop", async () => {
  const probe = await createProbe();
  const post = async (path: string) => {
    const r = await fetch(`${probe.base}${path}`, {
      method: "POST",
      body: "SECRET",
    });
    return { status: r.status, body: await r.text() };
  };
  try {
    assert.equal((await post("/start/private/initial")).status, 400);
    assert.equal((await post("/beat/1")).status, 400);
    assert.deepEqual(await post("/start/primary/initial"), {
      status: 200,
      body: "1",
    });
    assert.equal(probe.snapshot().instances[0]!.recentHeartbeat, false);
    await post("/beat/1");
    assert.equal(probe.snapshot().instances[0]!.recentHeartbeat, true);
    await post("/stop/1");
    await post("/beat/1");
    const snapshot = probe.snapshot();
    assert.equal(snapshot.instances[0]!.recentHeartbeat, false);
    assert.ok(snapshot.instances[0]!.stoppedAt);
    assert.ok(!JSON.stringify(snapshot).includes("SECRET"));
  } finally {
    await probe.close();
  }
});
