import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { summarizeObservations } from "../src/summary.js";
import { observation } from "../src/record.js";
import { startDashboard } from "../src/dashboard.js";

async function liveRecords() {
  return JSON.parse(
    await readFile(
      "experiments/local-telemetry-system/results/20260928-integration-current.json",
      "utf8",
    ),
  ).integration.backend.records;
}

test("dashboard counts saved real receipts while preserving ambiguous and dirty provenance", async () => {
  const result = summarizeObservations(await liveRecords());
  assert.deepEqual(
    result.map((row) => row.total),
    [5, 1],
  );
  assert.equal(result[0]!.resolution, "modified-deployment");
  assert.equal(result[1]!.resolution, "unique-deployment");
  assert.equal(result[0]!.coverage, "received-only-completeness-unknown");
  assert.ok(
    summarizeObservations([]).every(
      (row) => row.total === null && row.countState === "no-sample",
    ),
  );
});

test("retries deduplicate exact records; unretained series cannot resolve overlapping intervals", async () => {
  const rows = await liveRecords();
  const first = observation(rows[0]);
  assert.equal(summarizeObservations([first, first])[0]!.total, 1);
  const replay = {
    ...first,
    observedAt: new Date(Date.parse(first.observedAt) + 1000).toISOString(),
  };
  assert.equal(summarizeObservations([first, replay])[0]!.total, null);
  assert.equal(
    summarizeObservations([first, replay])[0]!.countState,
    "ambiguous-overlap",
  );
  const otherProducer = { ...replay, producerEpoch: "run-2" };
  assert.equal(summarizeObservations([first, otherProducer])[0]!.total, 2);
});

test("dashboard isolates real and synthetic data, rejects invalid filters and marks empty periods unknown", async () => {
  const server = await startDashboard(
    "experiments/local-telemetry-system/results",
    "experiments/local-telemetry-system/dashboard",
  );
  try {
    const real = await fetch(`${server.url}/api`).then((r) => r.json());
    assert.equal(real.evidence, "real-cli");
    assert.deepEqual(
      real.rows.map((row: { total: number }) => row.total),
      [7, 3],
    );
    assert.equal(real.checkpoints.length, 0);
    assert.ok(
      real.timeline.every(
        (row: { producer: string }) => row.producer !== "delivery-fixture",
      ),
    );
    const synthetic = await fetch(
      `${server.url}/api?evidence=synthetic-delivery`,
    ).then((r) => r.json());
    assert.ok(
      synthetic.timeline.every(
        (row: { producer: string }) => row.producer === "delivery-fixture",
      ),
    );
    assert.equal(synthetic.checkpoints.length, 6);
    const empty = await fetch(`${server.url}/api?start=2099-01-01T00:00Z`).then(
      (r) => r.json(),
    );
    assert.ok(
      empty.rows.every((row: { total: number | null }) => row.total === null),
    );
    assert.equal(empty.timeline.length, 0);
    const invalid = await fetch(`${server.url}/api?evidence=raw-prompts`);
    assert.equal(invalid.status, 400);
    await invalid.body?.cancel();
    const home = await fetch(server.url);
    assert.match(
      home.headers.get("content-security-policy") ?? "",
      /script-src 'self'/,
    );
    await home.body?.cancel();
  } finally {
    await server.close();
  }
});
