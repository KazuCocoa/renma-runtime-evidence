import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("metadata baseline preserves update/remove observations without claiming runtime coverage", async () => {
  const r = JSON.parse(
    await readFile(
      "experiments/codex-plugin-lifecycle/results/20260928-metadata.json",
      "utf8",
    ),
  );
  assert.equal(r.modelTurns, 0);
  assert.equal(r.authenticationUsed, false);
  assert.equal(r.analyticsEnabled, false);
  assert.equal(r.phases.length, 9);
  assert.ok(
    r.phases.every(
      (p: {
        exporterEndpointTextPreserved: boolean;
        sharedReceiverHealthy: boolean;
      }) => p.exporterEndpointTextPreserved && p.sharedReceiverHealthy,
    ),
  );
  assert.equal(r.phases[0].skills[0].revision, "initial");
  assert.equal(r.phases[1].skills[0].enabled, true);
  assert.equal(
    r.disableScope,
    "per-process-config-override-not-persistent-switch",
  );
  assert.ok(
    r.phases
      .slice(3, 6)
      .every(
        (p: { skills: { revision: string }[]; originalCacheExists: boolean }) =>
          p.skills[0]!.revision === "updated" && !p.originalCacheExists,
      ),
  );
  assert.ok(
    r.phases
      .slice(6)
      .every((p: { skills: { entries: number }[] }) =>
        p.skills.every((s) => s.entries === 0),
      ),
  );
  assert.equal(r.updatedCachePresentBeforeRemove, true);
  assert.equal(r.updatedCacheExistsAfterRemove, false);
  assert.equal(r.sourceExistsAfterRemove, true);
  assert.equal(r.runtimeConsumerTermination, "not-measured");
  assert.equal(r.telemetryDeliveryDuringTransitions, "not-measured");
});

test("effective disable distinguishes CLI literal quotes from RPC dotted keys", async () => {
  const r = JSON.parse(
    await readFile(
      "experiments/codex-plugin-lifecycle/results/20260928-effective-config.json",
      "utf8",
    ),
  );
  const phase = (name: string) =>
    r.phases.find((p: { phase: string }) => p.phase === name);
  const quoted = phase("disabled-startup-override");
  assert.equal(quoted.configuration.pluginEnabled, true);
  assert.equal(quoted.configuration.literalQuotedPluginEnabled, false);
  const unquoted = phase("unquoted-startup-override");
  assert.equal(unquoted.configuration.pluginEnabled, false);
  assert.equal(unquoted.plugins.enabled, false);
  assert.ok(unquoted.skills.every((s: { entries: number }) => s.entries === 0));
  for (const server of ["existing-server", "new-server"]) {
    assert.equal(
      phase(`persistent-disable-${server}`).configuration.pluginEnabled,
      false,
    );
    assert.equal(
      phase(`persistent-enable-${server}`).configuration.pluginEnabled,
      true,
    );
  }
});

test("actual MCP instances survive transitions while fresh threads follow current state", async () => {
  const r = JSON.parse(
    await readFile(
      "experiments/codex-plugin-lifecycle/results/20260928-runtime-lifecycle.json",
      "utf8",
    ),
  );
  type Instance = {
    instance: number;
    role: string;
    revision: string;
    recentHeartbeat: boolean;
    stoppedAt: string | null;
  };
  type Snapshot = { instances: Instance[] };
  const phase = (name: string) =>
    r.phases.find((p: { phase: string }) => p.phase === name);
  const active = (snapshot: Snapshot, role: string) =>
    snapshot.instances.filter((i) => i.role === role && i.recentHeartbeat);
  for (const name of [
    "persistent-disable-existing-server",
    "removed-existing-server-default",
  ]) {
    const p = phase(name);
    const old = active(p.beforeNewThread, "primary");
    assert.equal(old.length, 1);
    assert.deepEqual(
      active(p.afterNewThread, "primary").map((i) => i.instance),
      old.map((i) => i.instance),
    );
    assert.equal(
      active(p.afterNewThread, "companion").length,
      active(p.beforeNewThread, "companion").length + 1,
    );
  }
  for (const name of [
    "unquoted-startup-override",
    "persistent-disable-new-server",
    "removed-new-server",
  ]) {
    assert.equal(active(phase(name).afterNewThread, "primary").length, 0);
    assert.equal(active(phase(name).afterNewThread, "companion").length, 1);
  }
  const updated = phase("updated-existing-server-default");
  assert.deepEqual(
    active(updated.beforeNewThread, "primary").map((i) => i.revision),
    ["initial"],
  );
  assert.deepEqual(
    active(updated.afterNewThread, "primary")
      .map((i) => i.revision)
      .sort(),
    ["initial", "updated"],
  );
  assert.ok(
    r.afterServerShutdown.instances.every(
      (i: Instance) => i.stoppedAt !== null && !i.recentHeartbeat,
    ),
  );
  assert.ok(
    r.phases.every(
      (p: {
        sharedReceiverHealthy: boolean;
        exporterEndpointTextPreserved: boolean;
      }) => p.sharedReceiverHealthy && p.exporterEndpointTextPreserved,
    ),
  );
  assert.equal(r.modelTurns, 0);
  assert.equal(r.analyticsEnabled, false);
  assert.equal(r.telemetryDeliveryDuringTransitions, "not-measured");
});
