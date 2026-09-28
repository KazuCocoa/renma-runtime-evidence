import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { worker } from "../src/process.js";
import { fixture } from "../src/fixtures.js";
import { aggregationCases } from "../src/aggregation.js";
const report = async (name: string) =>
  JSON.parse(
    await readFile(
      `experiments/telemetry-hardening/results/20260928-${name}.json`,
      "utf8",
    ),
  );

test("OS-process sender restart reloads persisted reduced records", async () => {
  const root = await mkdtemp(join(tmpdir(), "renma-process-test-"));
  const token = randomBytes(32).toString("hex");
  const backend = await worker(
    "backend",
    join(root, "stored.json"),
    "0",
    token,
  );
  let sender = await worker(
    "sender",
    join(root, "queue.json"),
    backend.endpoint!,
    token,
  );
  try {
    await sender.request("enqueue", await fixture(1));
    await sender.kill();
    sender = await worker(
      "sender",
      join(root, "queue.json"),
      backend.endpoint!,
      token,
    );
    assert.equal((await sender.request("snapshot")).pending, 1);
    await sender.request("flush");
    assert.equal((await sender.request("snapshot")).pending, 0);
    assert.equal((await backend.request("snapshot")).stored, 1);
  } finally {
    await sender.kill();
    await backend.kill();
    await rm(root, { recursive: true, force: true });
  }
});

test("saved durable queue evidence distinguishes successful recovery and bounded backpressure", async () => {
  const r = await report("durability");
  assert.equal(r.modelTurns, 0);
  const phases = new Map(r.events.map((e: any) => [e.phase, e]));
  assert.equal(
    (phases.get("tcp-disconnected-queue-retained") as any).sender.pending,
    1,
  );
  const restart = phases.get(
    "backend-restarted-exact-retry-deduplicated",
  ) as any;
  assert.equal(restart.backend.stored, 1);
  assert.equal(restart.backend.duplicates, 1);
  assert.equal(restart.sender.pending, 0);
  assert.equal(
    r.persistentCollector.actualStored,
    r.persistentCollector.expectedStored,
  );
  assert.deepEqual(r.persistentCollector.acceptedStatuses, Array(8).fill(200));
  assert.equal(r.persistentCollector.fsync, true);
  assert.ok(r.persistentCollector.storageBytes > 0);
  assert.ok(
    r.saturation.accepted > 0 && r.saturation.accepted < r.saturation.submitted,
  );
  assert.equal(r.saturation.deliveredAfterRecovery, r.saturation.accepted);
  assert.ok(r.saturation.statuses.some((s: number) => s !== 200));
});

test("saved TLS/auth evidence rejects trust, hostname and credentials before delivery", async () => {
  const r = await report("security"),
    e = r.events;
  assert.equal(r.verification.rejectUnauthorized, true);
  assert.equal(r.verification.globalTrustModified, false);
  assert.ok(e[0].error);
  assert.equal(e[0].stored, 0);
  assert.equal(e[1].error, "ERR_TLS_CERT_ALTNAME_INVALID");
  assert.equal(e[1].stored, 0);
  assert.equal(e[2].status, 401);
  assert.equal(e[3].status, 401);
  assert.equal(e[4].status, 200);
  assert.equal(e[5].status, 401);
  assert.equal(e[6].status, 200);
  assert.equal(e[7].error, "TEST_TIMEOUT");
  assert.equal(e[8].status, 200);
  assert.equal(r.uniqueStored, 1);
  assert.equal(r.duplicates, 3);
});

test("saved plugin and portfolio evidence preserves explicit scope and rejection controls", async () => {
  const p = await report("plugins");
  assert.equal(p.modelTurns, 0);
  assert.equal(p.collisionResult, "address-in-use");
  assert.ok(
    p.events.every(
      (e: any) =>
        e.receiverHealthy &&
        e.exporterEndpointPreserved &&
        e.jsonProtocolPreserved,
    ),
  );
  assert.ok(
    p.events
      .slice(0, 3)
      .every((e: any) =>
        e.states.every((s: any) => s.connected && s.identified),
      ),
  );
  const removed = p.events.find(
    (e: any) => e.phase === "removed-fresh-thread-peer-survives",
  );
  assert.equal(removed.states[0].matches, 0);
  assert.equal(removed.states[1].connected, true);
  const r = await report("load");
  assert.equal(r.inventory.repositories, 20);
  assert.equal(r.inventory.skills, 1000);
  assert.equal(r.load.concurrency, 8);
  assert.equal(r.load.uniqueStored, 4096);
  assert.equal(r.load.distinctSkills, 1000);
  assert.equal(r.load.allAccepted, true);
  assert.equal(r.load.overflowStatus, 507);
  assert.equal(r.load.unknownStatus, 400);
  assert.equal(r.load.sentinelPersisted, false);
  assert.equal(r.load.invalidChangedStorage, false);
  assert.equal(r.existingComponentBounds.senderOverflowRejected, true);
  assert.equal(r.existingComponentBounds.stored, 1024);
  assert.equal(r.existingComponentBounds.overflowStatus, 400);
});

test("aggregation boundaries distinguish zero, absence, delay, gaps, duplicates, overlap and mixed versions", async () => {
  const cases = await aggregationCases();
  for (const row of cases) {
    assert.equal(row.summary[0]!.total, row.expectedTotal, row.name);
    assert.equal(row.summary[0]!.countState, row.expectedState, row.name);
    assert.equal(row.summary[1]!.total, null);
  }
  assert.equal(cases.find((c) => c.name === "gap")!.summary[0]!.gaps, true);
  assert.equal(
    cases.find((c) => c.name === "delayed")!.summary[0]!.gaps,
    false,
  );
  assert.equal(
    cases.find((c) => c.name === "mixed-version")!.summary[0]!.resolution,
    "ambiguous-content",
  );
  const ui = await report("ui");
  assert.equal(ui.observedZero, 0);
  assert.equal(ui.cases.length, 6);
  assert.ok(ui.cases.every((c: any) => c.passed));
  assert.equal(ui.cases.find((c: any) => c.name === "gap").gapShown, true);
  assert.equal(
    ui.cases.find((c: any) => c.name === "overlap").overlapShown,
    true,
  );
  assert.equal(
    ui.cases.find((c: any) => c.name === "mixed-version").mixedShown,
    true,
  );
});
