import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ARTIFACT,
  TOKENS,
  artifactRevision,
  completedTurn,
  deployment,
  ephemeralThreadId,
  fixture,
  requireOptIn,
  startedTurnId,
} from "../src/contract.js";

test("freshness opt-in requires both consent flags exactly once", () => {
  requireOptIn(["--allow-codex-analytics", "--use-chatgpt-login"]);
  for (const args of [
    [],
    ["--use-chatgpt-login"],
    ["--allow-codex-analytics"],
    ["--allow-codex-analytics", "--allow-codex-analytics"],
    ["--allow-codex-analytics", "--use-chatgpt-login", "unknown"],
  ])
    assert.throws(() => requireOptIn(args));
});

test("only confirmed ephemeral threads may start model turns", () => {
  assert.equal(
    ephemeralThreadId({
      thread: { id: "transient-id", ephemeral: true, preview: "PRIVATE" },
    }),
    "transient-id",
  );
  for (const thread of [
    { id: "id" },
    { id: "id", ephemeral: false },
    { id: "", ephemeral: true },
    { id: "x".repeat(257), ephemeral: true },
  ])
    assert.throws(() => ephemeralThreadId({ thread }));
  assert.equal(
    startedTurnId({ turn: { id: "turn", items: ["PRIVATE"] } }),
    "turn",
  );
  assert.throws(() => startedTurnId({ turn: { id: null } }));
});

test("turn completion uses exact routing and finite status without retaining payloads", () => {
  const message = {
    method: "turn/completed",
    params: {
      threadId: "thread",
      turn: {
        id: "turn",
        status: "completed",
        items: ["PRIVATE_RESPONSE"],
        error: { message: "PRIVATE_ERROR" },
      },
    },
  };
  assert.equal(completedTurn(message, "thread", "turn"), "completed");
  assert.equal(completedTurn(message, "other", "turn"), undefined);
  assert.equal(completedTurn(message, "thread", "other"), undefined);
  assert.equal(
    completedTurn({ ...message, method: "item/completed" }, "thread", "turn"),
    undefined,
  );
  for (const status of ["failed", "interrupted", "PRIVATE_STATUS"])
    assert.equal(
      completedTurn(
        {
          ...message,
          params: {
            ...message.params,
            turn: { ...message.params.turn, status },
          },
        },
        "thread",
        "turn",
      ),
      status === "PRIVATE_STATUS" ? "unsupported" : status,
    );
});

test("deployment digests cover only known fixture bytes and remain immutable", () => {
  const a = deployment("a");
  const b = deployment("b");
  assert.notEqual(a.digest, b.digest);
  assert.equal(a.digest, deployment("a").digest);
  assert.equal(Object.isFrozen(a), true);
  assert.equal(a.revision, "a");
  assert.equal(a.provenance, "experiment-wrapper");
  assert.ok(fixture("a").includes(TOKENS.a));
  assert.ok(!fixture("a").includes(TOKENS.b));
});

test("artifact reducer rejects unknown content and symlinks without exporting bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "renma-freshness-test-"));
  try {
    assert.equal(await artifactRevision(root), "absent");
    for (const revision of ["a", "b"] as const) {
      await writeFile(join(root, ARTIFACT), TOKENS[revision]);
      assert.equal(await artifactRevision(root), revision);
    }
    await writeFile(join(root, ARTIFACT), "X".repeat(TOKENS.a.length));
    assert.equal(await artifactRevision(root), "unknown");
    await writeFile(join(root, ARTIFACT), TOKENS.a + "\n");
    assert.equal(await artifactRevision(root), "unknown");
    await rm(join(root, ARTIFACT));
    await writeFile(join(root, "outside"), TOKENS.a);
    await symlink(join(root, "outside"), join(root, ARTIFACT));
    assert.equal(await artifactRevision(root), "unknown");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
