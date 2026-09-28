import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { reserveTurn } from "../src/budget.js";

test("live turn budget fails closed at 60 and reserves before a call can fail", async () => {
  const root = await mkdtemp(join(tmpdir(), "renma-budget-test-"));
  const path = join(root, "ledger.json");
  try {
    await writeFile(
      path,
      JSON.stringify({
        schemaVersion: "renma.local-goal.turn-budget.v1",
        limit: 60,
        attempts: [],
      }),
    );
    for (let i = 1; i <= 60; i++)
      assert.equal(await reserveTurn(path, "plugin-integration"), i);
    await assert.rejects(reserveTurn(path, "plugin-integration"));
    assert.equal(JSON.parse(await readFile(path, "utf8")).attempts.length, 60);
    await writeFile(
      path,
      JSON.stringify({ schemaVersion: "wrong", limit: 60, attempts: [] }),
    );
    await assert.rejects(reserveTurn(path, "plugin-integration"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
