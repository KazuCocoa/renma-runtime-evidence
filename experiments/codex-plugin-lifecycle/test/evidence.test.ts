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
