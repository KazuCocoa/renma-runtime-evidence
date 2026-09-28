import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { startBackend } from "../src/backend.js";
import { durableSender } from "../src/sender.js";
import { observation, encodeOtlp, decodeOtlp } from "../src/record.js";
import { readRecords } from "../src/storage.js";

export async function sample(value = 1) {
  const report = JSON.parse(
    await readFile(
      "experiments/local-telemetry-system/results/20260928-sync.json",
      "utf8",
    ),
  );
  return observation({
    schemaVersion: "renma.local-observation.v1",
    producer: "delivery-fixture",
    producerEpoch: "run-1",
    receiverEpoch: "first",
    evidenceClass: "synthetic-delivery",
    observedAt: "2026-09-28T06:00:00.000Z",
    skill: "renma-usage-alpha",
    providerLabel: "renma-usage-fixture_renma-usage-alpha",
    value,
    aggregation: "delta",
    monotonic: true,
    seriesIdentity: "not-retained",
    intervalStart: "1790575199000000000",
    intervalEnd: "1790575200000000000",
    deployments: ["initial"],
    manifest: report.manifest,
    rawPrompt: "SECRET",
  });
}

test("OTLP projection and receiver strip unrelated content before persistence", async () => {
  const record = await sample();
  assert.ok(!JSON.stringify(record).includes("SECRET"));
  const packet = encodeOtlp([record]);
  const contaminated = JSON.parse(JSON.stringify(packet));
  contaminated.resourceLogs[0].resource = {
    attributes: [{ key: "raw", value: { stringValue: "SECRET" } }],
  };
  contaminated.resourceLogs[0].scopeLogs[0].logRecords[0].body = {
    stringValue: "SECRET",
  };
  assert.deepEqual(decodeOtlp(contaminated), [record]);
  const root = await mkdtemp(join(tmpdir(), "renma-delivery-test-"));
  const token = randomBytes(32).toString("hex"),
    path = join(root, "backend.json");
  const backend = await startBackend(path, token);
  try {
    const response = await fetch(backend.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(contaminated),
    });
    assert.equal(response.status, 200);
    await response.body?.cancel();
    assert.ok(!(await readFile(path, "utf8")).includes("SECRET"));
    assert.deepEqual(readRecords(path), [record]);
  } finally {
    await backend.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("outage, sender/backend reinitialization and lost acknowledgement preserve reduced records without double storage", async () => {
  const root = await mkdtemp(join(tmpdir(), "renma-retry-test-"));
  const token = randomBytes(32).toString("hex"),
    path = join(root, "backend.json"),
    queue = join(root, "queue.json");
  let backend = await startBackend(path, token);
  const endpoint = backend.endpoint;
  const port = Number(new URL(endpoint).port);
  try {
    let sender = durableSender(queue, endpoint, token);
    sender.enqueue(await sample());
    backend.setAccepting(false);
    await sender.flush();
    assert.equal(sender.snapshot().state, "retry");
    assert.equal(sender.snapshot().pending, 1);
    // Construct a fresh sender from disk; no in-memory queue survives this boundary.
    sender = durableSender(queue, endpoint, token);
    backend.setAccepting(true);
    backend.loseNextAcknowledgement();
    await sender.flush();
    assert.equal(sender.snapshot().pending, 1);
    assert.equal(backend.snapshot().records.length, 1);
    await backend.close();
    backend = await startBackend(path, token, port);
    await delay(120);
    await sender.flush();
    assert.equal(sender.snapshot().pending, 0);
    assert.equal(backend.snapshot().duplicates, 1);
    assert.equal(backend.snapshot().records.length, 1);
    const wrong = durableSender(queue, endpoint, "incorrect");
    wrong.enqueue(await sample(2));
    await wrong.flush();
    assert.equal(wrong.snapshot().state, "blocked-auth");
    assert.equal(wrong.snapshot().pending, 1);
    assert.equal(backend.snapshot().unauthorized, 1);
    await wrong.flush();
    assert.equal(backend.snapshot().unauthorized, 1);
    wrong.setToken(token);
    await wrong.flush();
    assert.equal(wrong.snapshot().pending, 0);
    assert.equal(backend.snapshot().records.length, 2);
  } finally {
    await backend.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("malformed or partial acknowledgements retain records and block blind retries", async () => {
  const { createServer } = await import("node:http");
  const root = await mkdtemp(join(tmpdir(), "renma-ack-test-"));
  let reply = "{}",
    requests = 0;
  const server = createServer((req, res) => {
    req.resume();
    requests++;
    res.writeHead(200, { "content-type": "application/json" }).end(reply);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    for (const [i, body] of [
      '{"partialSuccess":{"rejectedLogRecords":"1"}}',
      '{"partialSuccess":{"errorMessage":"fixture warning"}}',
      '{"partialSuccess":true}',
      '{"partialSuccess":{"rejectedLogRecords":[]}}',
      "not-json",
    ].entries()) {
      reply = body;
      const sender = durableSender(
        join(root, `queue-${i}.json`),
        `http://127.0.0.1:${address.port}/v1/logs`,
        "fixture",
      );
      sender.enqueue(await sample());
      await sender.flush();
      assert.equal(sender.snapshot().pending, 1);
      assert.equal(
        sender.snapshot().state,
        i < 2 ? "blocked-partial" : "blocked-payload",
      );
      const before = requests;
      await sender.flush();
      assert.equal(requests, before);
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test("allowlisted scalars reject coercible arrays rather than persisting arbitrary shapes", async () => {
  const record = await sample();
  for (const key of [
    "skill",
    "providerLabel",
    "producerEpoch",
    "receiverEpoch",
  ] as const) {
    assert.throws(() => observation({ ...record, [key]: [record[key]] }));
  }
  for (const key of ["sourceCommit", "contentDigest"] as const) {
    assert.throws(() =>
      observation({
        ...record,
        manifest: record.manifest.map((row) => ({ ...row, [key]: [row[key]] })),
      }),
    );
  }
});
