import { test } from "node:test";
import assert from "node:assert/strict";
import {
  realpath,
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
test("hook distinguishes path reference from returned fixture and discards arbitrary content", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "renma-hook-test-")),
  );
  try {
    for (const alias of ["a", "b"]) {
      const dir = join(root, "skills", alias, "code-review");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "SKILL.md"), `authored fixture ${alias}\n`);
    }
    const file = join(root, "events.jsonl");
    const invoke = (input: unknown) => {
      const p = spawnSync(
        process.execPath,
        [resolve("experiments/codex-plugin-skill-read/src/observe.cjs"), file],
        {
          env: { PLUGIN_ROOT: root },
          input: JSON.stringify(input),
          encoding: "utf8",
        },
      );
      assert.equal(p.status, 0);
      assert.equal(p.stdout, "");
    };
    invoke({
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: {
        command: `cat '${join(root, "skills/b/code-review/SKILL.md")}'`,
      },
      tool_response: { output: "authored fixture b\n" },
      prompt: "SECRET",
      transcript_path: "SECRET",
    });
    invoke({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: {
        command: `echo '${join(root, "skills/a/code-review/SKILL.md")}' SECRET`,
      },
    });
    const raw = await readFile(file, "utf8");
    const rows = raw
      .trim()
      .split("\n")
      .map((s) => JSON.parse(s));
    assert.deepEqual(rows[0].fullFixtureReturned, ["B"]);
    assert.equal(rows[0].pathReferences[0].asset, "B");
    assert.deepEqual(rows[1].fullFixtureReturned, []);
    assert.equal(rows[1].pathReferences[0].asset, "A");
    assert.ok(!raw.includes("SECRET"));
    assert.ok(!raw.includes(root));
    assert.ok(!raw.includes("authored fixture"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
