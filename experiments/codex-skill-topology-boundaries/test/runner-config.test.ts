import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertExperimentChildEnvironment,
  AUTHENTICATION_ENVIRONMENT_VARIABLES,
  buildCodexExecArguments,
  buildExperimentChildEnvironment,
  buildExecutionChildEnvironment,
  EXECUTION_ENVIRONMENT_VARIABLES,
  normalizeRequestedModelConfiguration,
  parseRunnerArguments,
  SUPPORTED_REASONING_EFFORTS,
} from "../src/runner-config.js";

test("builds a finite child environment without mutating its source", () => {
  const sourceEnvironment: NodeJS.ProcessEnv = {
    PATH: "/synthetic/bin",
    TMPDIR: "/synthetic/tmp",
    TMP: undefined,
    LANG: "en_US.UTF-8",
    LC_ALL: "C",
    HOME: "/synthetic/home",
    CODEX_HOME: "/synthetic/codex-home",
    CODEX_API_KEY: "SYNTHETIC_AUTH_VALUE",
    RENMA_PRIVATE_SENTINEL: "PRIVATE_SENTINEL_MUST_NOT_BE_FORWARDED",
  };
  const sourceBefore = { ...sourceEnvironment };

  const childEnvironment = buildExperimentChildEnvironment(sourceEnvironment);

  assert.deepEqual(childEnvironment, {
    PATH: "/synthetic/bin",
    TMPDIR: "/synthetic/tmp",
    LANG: "en_US.UTF-8",
    LC_ALL: "C",
    HOME: "/synthetic/home",
    CODEX_HOME: "/synthetic/codex-home",
    CODEX_API_KEY: "SYNTHETIC_AUTH_VALUE",
  });
  assert.equal("TMP" in childEnvironment, false);
  assert.equal("RENMA_PRIVATE_SENTINEL" in childEnvironment, false);
  assert.equal(
    Object.values(childEnvironment).includes(
      "PRIVATE_SENTINEL_MUST_NOT_BE_FORWARDED",
    ),
    false,
  );
  assert.deepEqual(sourceEnvironment, sourceBefore);
  assert.notStrictEqual(childEnvironment, sourceEnvironment);
});

test("keeps authentication variables out of non-Codex child environments", () => {
  const executionEnvironment = buildExecutionChildEnvironment({
    PATH: "/synthetic/bin",
    TMPDIR: "/synthetic/tmp",
    LANG: "en_US.UTF-8",
    HOME: "/synthetic/home",
    CODEX_HOME: "/synthetic/codex-home",
    CODEX_API_KEY: "SYNTHETIC_AUTH_VALUE",
  });

  assert.deepEqual(executionEnvironment, {
    PATH: "/synthetic/bin",
    TMPDIR: "/synthetic/tmp",
    LANG: "en_US.UTF-8",
  });
});

test("exposes only finite execution and authentication variable-name allowlists", () => {
  assert.deepEqual(EXECUTION_ENVIRONMENT_VARIABLES, [
    "PATH",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
  ]);
  assert.deepEqual(AUTHENTICATION_ENVIRONMENT_VARIABLES, [
    "HOME",
    "CODEX_HOME",
    "CODEX_API_KEY",
  ]);
});

test("requires executable lookup and an explicit authentication route", () => {
  assert.throws(
    () => assertExperimentChildEnvironment({ HOME: "/synthetic/home" }),
    /requires PATH/,
  );
  assert.throws(
    () => assertExperimentChildEnvironment({ PATH: "/synthetic/bin" }),
    /no explicit Codex authentication source/,
  );
  assert.doesNotThrow(() =>
    assertExperimentChildEnvironment({
      PATH: "/synthetic/bin",
      CODEX_API_KEY: "SYNTHETIC_AUTH_VALUE",
    }),
  );
});

test("requires and validates explicit model arguments before execution", () => {
  assert.throws(
    () => parseRunnerArguments([], "/synthetic/report.json"),
    /--model is required/,
  );
  assert.throws(
    () =>
      parseRunnerArguments(["--model", "gpt-5.6"], "/synthetic/report.json"),
    /--reasoning-effort is required/,
  );
  assert.throws(
    () =>
      parseRunnerArguments(
        ["--model", "invalid model", "--reasoning-effort", "medium"],
        "/synthetic/report.json",
      ),
    /--model must be an explicit identifier/,
  );
  assert.throws(
    () =>
      parseRunnerArguments(
        ["--model", "gpt-5.6", "--reasoning-effort", "ultra"],
        "/synthetic/report.json",
      ),
    /--reasoning-effort must be one of/,
  );
  assert.deepEqual(SUPPORTED_REASONING_EFFORTS, [
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
  ]);
});

test("normalizes exact requested model configuration into report metadata", () => {
  assert.deepEqual(normalizeRequestedModelConfiguration("gpt-5.6", "medium"), {
    requestedModel: "gpt-5.6",
    requestedReasoningEffort: "medium",
  });

  assert.deepEqual(
    parseRunnerArguments(
      ["--runs", "3", "--model", "gpt-5.6", "--reasoning-effort", "medium"],
      "/synthetic/report.json",
    ),
    {
      outputPath: "/synthetic/report.json",
      runs: 3,
      requestedModel: "gpt-5.6",
      requestedReasoningEffort: "medium",
    },
  );
});

test("propagates exact model and reasoning settings into Codex invocation", () => {
  const args = buildCodexExecArguments({
    collectorEndpoint: "http://127.0.0.1:4318/v1/metrics",
    prompt: "SYNTHETIC_PROMPT",
    temporaryWorkspace: "/synthetic/workspace",
    requestedModel: "gpt-5.6",
    requestedReasoningEffort: "medium",
  });

  const modelIndex = args.indexOf("--model");
  assert.notEqual(modelIndex, -1);
  assert.equal(args[modelIndex + 1], "gpt-5.6");
  assert.equal(args.includes('model_reasoning_effort="medium"'), true);
  assert.equal(args.includes("--ephemeral"), true);
  assert.equal(args.includes("--ignore-user-config"), true);
  assert.equal(args.includes("--ignore-rules"), true);
  assert.equal(args.includes('sandbox_mode="read-only"'), true);
  assert.equal(args.includes('approval_policy="never"'), true);
  assert.equal(args.at(-1), "SYNTHETIC_PROMPT");
});

test("custom agents inherit the parent model configuration", async () => {
  const testDirectory = dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = resolve(testDirectory, "../../../..");
  const agentDirectory = join(
    repositoryRoot,
    "experiments/codex-skill-topology-boundaries/fixtures/agents",
  );
  const agentFiles = await readdir(agentDirectory);

  assert.equal(agentFiles.length, 5);
  for (const agentFile of agentFiles) {
    const contents = await readFile(join(agentDirectory, agentFile), "utf8");
    assert.equal(/^model\s*=/m.test(contents), false);
    assert.equal(/^model_reasoning_effort\s*=/m.test(contents), false);
  }
});
