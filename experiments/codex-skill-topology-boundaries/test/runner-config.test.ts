import assert from "node:assert/strict";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import test from "node:test";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildConsoleSummary,
  buildExperimentReport,
} from "../src/run-experiment.js";
import {
  assertExperimentChildEnvironment,
  AUTHENTICATION_ISOLATION_MODE,
  AUTHENTICATION_ENVIRONMENT_VARIABLES,
  buildCodexExecArguments,
  buildExperimentChildEnvironment,
  buildExecutionChildEnvironment,
  cleanupIsolatedRunDirectories,
  createIsolatedRunDirectories,
  EXECUTION_ENVIRONMENT_VARIABLES,
  ISOLATED_LOCATION_ENVIRONMENT_VARIABLES,
  normalizeRequestedModelConfiguration,
  parseRunnerArguments,
  preflightIsolatedExperimentEnvironment,
  requireCodexApiKey,
  SUPPORTED_REASONING_EFFORTS,
  type IsolatedRunDirectories,
} from "../src/runner-config.js";

function syntheticIsolatedDirectories(): IsolatedRunDirectories {
  const rootDirectory = resolve("/synthetic/run");
  return {
    rootDirectory,
    workspaceDirectory: join(rootDirectory, "workspace"),
    homeDirectory: join(rootDirectory, "home"),
    codexHomeDirectory: join(rootDirectory, "codex-home"),
  };
}

test("builds an API-key environment with isolated homes without mutating its source", () => {
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
  const isolatedDirectories = syntheticIsolatedDirectories();

  const childEnvironment = buildExperimentChildEnvironment(
    sourceEnvironment,
    isolatedDirectories,
  );

  assert.deepEqual(childEnvironment, {
    PATH: "/synthetic/bin",
    TMPDIR: "/synthetic/tmp",
    LANG: "en_US.UTF-8",
    LC_ALL: "C",
    HOME: isolatedDirectories.homeDirectory,
    CODEX_HOME: isolatedDirectories.codexHomeDirectory,
    CODEX_API_KEY: "SYNTHETIC_AUTH_VALUE",
  });
  assert.notEqual(childEnvironment.HOME, sourceEnvironment.HOME);
  assert.notEqual(childEnvironment.CODEX_HOME, sourceEnvironment.CODEX_HOME);
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
  assert.deepEqual(AUTHENTICATION_ENVIRONMENT_VARIABLES, ["CODEX_API_KEY"]);
  assert.deepEqual(ISOLATED_LOCATION_ENVIRONMENT_VARIABLES, [
    "HOME",
    "CODEX_HOME",
  ]);
  assert.equal(AUTHENTICATION_ISOLATION_MODE, "api-key");
});

test("requires API-key authentication and exact isolated locations", () => {
  const isolatedDirectories = syntheticIsolatedDirectories();
  assert.throws(
    () =>
      assertExperimentChildEnvironment(
        { HOME: isolatedDirectories.homeDirectory },
        isolatedDirectories,
      ),
    /requires PATH/,
  );
  assert.throws(
    () =>
      assertExperimentChildEnvironment(
        {
          PATH: "/synthetic/bin",
          HOME: isolatedDirectories.homeDirectory,
          CODEX_HOME: isolatedDirectories.codexHomeDirectory,
        },
        isolatedDirectories,
      ),
    /requires explicit CODEX_API_KEY/,
  );
  assert.throws(
    () =>
      assertExperimentChildEnvironment(
        {
          PATH: "/synthetic/bin",
          HOME: "/caller/home",
          CODEX_HOME: isolatedDirectories.codexHomeDirectory,
          CODEX_API_KEY: "SYNTHETIC_AUTH_VALUE",
        },
        isolatedDirectories,
      ),
    /must exactly match/,
  );
  assert.throws(
    () =>
      assertExperimentChildEnvironment(
        {
          PATH: "/synthetic/bin",
          HOME: "relative-home",
          CODEX_HOME: "relative-codex-home",
          CODEX_API_KEY: "SYNTHETIC_AUTH_VALUE",
        },
        {
          ...isolatedDirectories,
          homeDirectory: "relative-home",
          codexHomeDirectory: "relative-codex-home",
        },
      ),
    /must use absolute paths/,
  );
  assert.doesNotThrow(() =>
    assertExperimentChildEnvironment(
      {
        PATH: "/synthetic/bin",
        HOME: isolatedDirectories.homeDirectory,
        CODEX_HOME: isolatedDirectories.codexHomeDirectory,
        CODEX_API_KEY: "SYNTHETIC_AUTH_VALUE",
      },
      isolatedDirectories,
    ),
  );
});

test("rejects implicit saved-login authentication from caller home paths", () => {
  const sourceEnvironment = {
    PATH: "/synthetic/bin",
    HOME: "/real-looking/user/home",
    CODEX_HOME: "/real-looking/user/codex-home",
  };

  assert.throws(
    () => requireCodexApiKey(sourceEnvironment),
    /requires CODEX_API_KEY/,
  );
  assert.throws(
    () =>
      buildExperimentChildEnvironment(
        sourceEnvironment,
        syntheticIsolatedDirectories(),
      ),
    /implicit saved-login authentication.*prohibited/,
  );
});

test("creates empty per-run authentication locations and removes them", async () => {
  const isolatedDirectories = await createIsolatedRunDirectories();
  const childEnvironment = buildExperimentChildEnvironment(
    {
      PATH: "/synthetic/bin",
      CODEX_API_KEY: "SYNTHETIC_AUTH_VALUE",
    },
    isolatedDirectories,
  );

  try {
    await preflightIsolatedExperimentEnvironment(
      childEnvironment,
      isolatedDirectories,
    );
    await writeFile(
      join(isolatedDirectories.codexHomeDirectory, "synthetic-state"),
      "synthetic",
      "utf8",
    );
    await assert.rejects(
      preflightIsolatedExperimentEnvironment(
        childEnvironment,
        isolatedDirectories,
      ),
      /must be empty/,
    );
  } finally {
    await cleanupIsolatedRunDirectories(isolatedDirectories);
  }

  await assert.rejects(stat(isolatedDirectories.rootDirectory), {
    code: "ENOENT",
  });
});

test("normalized report and console summary exclude environment and credential values", () => {
  const callerHome = "/real-looking/user/home-private-sentinel";
  const callerCodexHome = "/real-looking/user/codex-private-sentinel";
  const apiKey = "SYNTHETIC_API_KEY_PRIVATE_SENTINEL";
  const contaminatedOptions = {
    experimentDate: "2026-08-06",
    environment: {
      codexVersion: "codex-cli 0.146.0",
      operatingSystem: "Synthetic OS",
      architecture: "synthetic-arch",
      nodeVersion: "v24.18.0",
      HOME: callerHome,
      CODEX_HOME: callerCodexHome,
    },
    modelConfiguration: {
      requestedModel: "gpt-5.6-sol",
      requestedReasoningEffort: "medium" as const,
    },
    runsPerScenario: 3,
    scenarios: [
      {
        scenario: "nested-chain-depth-2" as const,
        runs: [
          {
            schemaVersion: 1 as const,
            provider: "codex" as const,
            experiment: "codex-skill-topology-boundaries" as const,
            scenario: "nested-chain-depth-2" as const,
            experimentRunId: "00000000-0000-4000-8000-000000000000",
            codexExitCode: 0,
            injectedSkills: [],
            spawnedRoles: [],
            CODEX_API_KEY: apiKey,
          },
        ],
      },
    ],
    CODEX_API_KEY: apiKey,
  };

  const report = buildExperimentReport(contaminatedOptions);
  const consoleSummary = buildConsoleSummary(report);
  const serializedOutputs = JSON.stringify({ report, consoleSummary });

  assert.equal(report.authenticationIsolationMode, "api-key");
  assert.equal(serializedOutputs.includes(callerHome), false);
  assert.equal(serializedOutputs.includes(callerCodexHome), false);
  assert.equal(serializedOutputs.includes(apiKey), false);
  assert.equal(serializedOutputs.includes("CODEX_API_KEY"), false);
  assert.equal(serializedOutputs.includes('"HOME"'), false);
  assert.equal(serializedOutputs.includes('"CODEX_HOME"'), false);
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
