import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildConsoleSummary,
  buildExperimentReport,
  CODEX_EXEC_STDIO,
  SCENARIO_DEFINITIONS,
  type RunSummary,
  type ScenarioSummary,
} from "../src/run-experiment.js";
import {
  assertExperimentChildEnvironment,
  AUTHENTICATION_ISOLATION_MODE,
  buildCodexExecArguments,
  buildExperimentChildEnvironment,
  buildExecutionChildEnvironment,
  cleanupIsolatedRunDirectories,
  createIsolatedRunDirectories,
  EXECUTION_ENVIRONMENT_VARIABLES,
  EXPECTED_CODEX_VERSION,
  parseRunnerArguments,
  preflightIsolatedExperimentEnvironment,
  REQUESTED_MODEL,
  REQUESTED_REASONING_EFFORT,
  requireCodexApiKey,
  requireExpectedCodexVersion,
  RUNS_PER_SCENARIO,
  type IsolatedRunDirectories,
} from "../src/runner-config.js";
import {
  EXPERIMENT_ID,
  SCENARIO_IDS,
  SYNTHETIC_AGENT_ROLES,
  SYNTHETIC_SKILL_NAMES,
  type ScenarioId,
  type SpawnSignalObservation,
} from "../src/signals.js";

function syntheticDirectories(): IsolatedRunDirectories {
  const rootDirectory = resolve("/synthetic/spawn-signal-run");
  return {
    rootDirectory,
    workspaceDirectory: join(rootDirectory, "workspace"),
    homeDirectory: join(rootDirectory, "home"),
    codexHomeDirectory: join(rootDirectory, "codex-home"),
  };
}

function makeRun(
  scenario: ScenarioId,
  observation: SpawnSignalObservation,
): RunSummary {
  return {
    schemaVersion: 1,
    provider: "codex",
    experiment: EXPERIMENT_ID,
    scenario,
    codexExitCode: 0,
    ...observation,
  };
}

function emptyObservation(): SpawnSignalObservation {
  return {
    spawnMetricObserved: false,
    spawnDataPointObserved: false,
    spawnRoleClassifications: [],
    spawnedRoles: [],
  };
}

function exactScenarios(observation = emptyObservation()): ScenarioSummary[] {
  return SCENARIO_IDS.map((scenario) => ({
    scenario,
    runs: Array.from({ length: RUNS_PER_SCENARIO }, () =>
      makeRun(scenario, observation),
    ),
  }));
}

test("builds a minimized API-key environment with fresh HOME locations", () => {
  const source: NodeJS.ProcessEnv = {
    PATH: "/synthetic/bin",
    TMPDIR: "/synthetic/tmp",
    LANG: "C",
    HOME: "/CALLER/HOME/PRIVATE",
    CODEX_HOME: "/CALLER/CODEX_HOME/PRIVATE",
    CODEX_API_KEY: "SYNTHETIC_PRIVATE_API_KEY",
    PRIVATE_SENTINEL: "PRIVATE_ENVIRONMENT_VALUE",
  };
  const before = { ...source };
  const directories = syntheticDirectories();
  const child = buildExperimentChildEnvironment(source, directories);

  assert.deepEqual(child, {
    PATH: "/synthetic/bin",
    TMPDIR: "/synthetic/tmp",
    LANG: "C",
    HOME: directories.homeDirectory,
    CODEX_HOME: directories.codexHomeDirectory,
    CODEX_API_KEY: "SYNTHETIC_PRIVATE_API_KEY",
  });
  assert.equal(child.HOME === source.HOME, false);
  assert.equal(child.CODEX_HOME === source.CODEX_HOME, false);
  assert.equal("PRIVATE_SENTINEL" in child, false);
  assert.deepEqual(source, before);
});

test("keeps credentials and caller home locations out of helper processes", () => {
  const child = buildExecutionChildEnvironment({
    PATH: "/synthetic/bin",
    TMPDIR: "/synthetic/tmp",
    HOME: "/CALLER/HOME/PRIVATE",
    CODEX_HOME: "/CALLER/CODEX_HOME/PRIVATE",
    CODEX_API_KEY: "SYNTHETIC_PRIVATE_API_KEY",
  });
  assert.deepEqual(child, {
    PATH: "/synthetic/bin",
    TMPDIR: "/synthetic/tmp",
  });
  assert.deepEqual(EXECUTION_ENVIRONMENT_VARIABLES, [
    "PATH",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
  ]);
});

test("rejects saved-login fallback and non-isolated child environments", () => {
  const directories = syntheticDirectories();
  assert.throws(
    () => requireCodexApiKey({ HOME: "/CALLER/HOME/PRIVATE" }),
    /API-key authentication is required/,
  );
  assert.throws(
    () =>
      assertExperimentChildEnvironment(
        {
          PATH: "/synthetic/bin",
          HOME: "/CALLER/HOME/PRIVATE",
          CODEX_HOME: directories.codexHomeDirectory,
          CODEX_API_KEY: "SYNTHETIC_PRIVATE_API_KEY",
        },
        directories,
      ),
    /must use isolated locations/,
  );
  assert.doesNotThrow(() =>
    assertExperimentChildEnvironment(
      {
        PATH: "/synthetic/bin",
        HOME: directories.homeDirectory,
        CODEX_HOME: directories.codexHomeDirectory,
        CODEX_API_KEY: "SYNTHETIC_PRIVATE_API_KEY",
      },
      directories,
    ),
  );
});

test("creates empty per-run locations and removes the full isolation root", async () => {
  const directories = await createIsolatedRunDirectories();
  const child = buildExperimentChildEnvironment(
    { PATH: "/synthetic/bin", CODEX_API_KEY: "SYNTHETIC_PRIVATE_API_KEY" },
    directories,
  );

  try {
    await preflightIsolatedExperimentEnvironment(child, directories);
    await writeFile(
      join(directories.codexHomeDirectory, "synthetic-state"),
      "synthetic",
      "utf8",
    );
    await assert.rejects(
      preflightIsolatedExperimentEnvironment(child, directories),
      /must start empty/,
    );
  } finally {
    await cleanupIsolatedRunDirectories(directories);
  }
  await assert.rejects(stat(directories.rootDirectory), { code: "ENOENT" });
});

test("requires the exact run count, model, reasoning effort, and CLI version", () => {
  const exactArguments = [
    "--runs",
    "3",
    "--model",
    "gpt-5.6-sol",
    "--reasoning-effort",
    "medium",
  ];
  assert.deepEqual(
    parseRunnerArguments(exactArguments, "/synthetic/report.json"),
    {
      outputPath: "/synthetic/report.json",
      runs: 3,
      requestedModel: "gpt-5.6-sol",
      requestedReasoningEffort: "medium",
    },
  );
  assert.throws(
    () =>
      parseRunnerArguments(
        [...exactArguments.slice(0, 1), "4", ...exactArguments.slice(2)],
        "/synthetic/report.json",
      ),
    /exact run configuration/,
  );
  assert.throws(
    () =>
      parseRunnerArguments(
        ["--runs", "3", "--model", "gpt-5.6", "--reasoning-effort", "medium"],
        "/synthetic/report.json",
      ),
    /exact run configuration/,
  );
  assert.throws(
    () => parseRunnerArguments([], "/synthetic/report.json"),
    /exact run configuration/,
  );
  assert.equal(
    requireExpectedCodexVersion(EXPECTED_CODEX_VERSION),
    EXPECTED_CODEX_VERSION,
  );
  assert.throws(
    () => requireExpectedCodexVersion("codex-cli 0.147.0"),
    /exact Codex CLI version/,
  );
});

test("passes the explicit isolated Codex configuration and retains no task streams", () => {
  const args = buildCodexExecArguments({
    collectorEndpoint: "http://127.0.0.1:4318/v1/metrics",
    prompt: "SYNTHETIC_PARENT_PROMPT",
    temporaryWorkspace: "/synthetic/workspace",
    requestedModel: REQUESTED_MODEL,
    requestedReasoningEffort: REQUESTED_REASONING_EFFORT,
  });

  const modelIndex = args.indexOf("--model");
  assert.equal(args[modelIndex + 1], "gpt-5.6-sol");
  assert.equal(args.includes('model_reasoning_effort="medium"'), true);
  assert.equal(args.includes("--ephemeral"), true);
  assert.equal(args.includes("--ignore-user-config"), true);
  assert.equal(args.includes("--ignore-rules"), true);
  assert.equal(args.includes('sandbox_mode="read-only"'), true);
  assert.equal(args.includes('approval_policy="never"'), true);
  assert.equal(args.includes("otel.log_user_prompt=false"), true);
  assert.equal(args.includes('otel.exporter="none"'), true);
  assert.equal(args.includes('otel.trace_exporter="none"'), true);
  assert.equal(args.at(-1), "SYNTHETIC_PARENT_PROMPT");
  assert.deepEqual(CODEX_EXEC_STDIO, ["ignore", "ignore", "ignore"]);
});

test("uses exactly four scenarios, three runs each, and one parent Skill name", () => {
  assert.deepEqual(
    SCENARIO_DEFINITIONS.map((definition) => definition.id),
    SCENARIO_IDS,
  );
  assert.equal(RUNS_PER_SCENARIO, 3);
  for (const definition of SCENARIO_DEFINITIONS) {
    const promptSkillNames = [...definition.prompt.matchAll(/\$([\w-]+)/g)].map(
      (match) => match[1],
    );
    assert.equal(promptSkillNames.length, 1);
    assert.equal(
      promptSkillNames[0]?.startsWith("renma-spawn-signal-orchestrator-"),
      true,
    );
    for (const role of SYNTHETIC_AGENT_ROLES) {
      assert.equal(definition.prompt.includes(role), false);
    }
    for (const childSkill of [
      "renma-spawn-signal-nested-root-20260806",
      "renma-spawn-signal-nested-leaf-20260806",
    ]) {
      assert.equal(definition.prompt.includes(childSkill), false);
    }
  }

  const report = buildExperimentReport({
    experimentDate: "2026-08-06",
    codexVersion: EXPECTED_CODEX_VERSION,
    scenarios: exactScenarios(),
  });
  assert.equal(report.scenarios.length, 4);
  assert.equal(
    report.scenarios.every(({ runs }) => runs.length === 3),
    true,
  );
});

test("keeps custom-agent model settings inherited and child Skill names controlled", async () => {
  const testDirectory = dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = resolve(testDirectory, "../../../..");
  const experimentDirectory = join(
    repositoryRoot,
    "experiments/codex-subagent-spawn-signals",
  );
  const agentDirectory = join(experimentDirectory, "fixtures/agents");
  const agentFiles = await readdir(agentDirectory);

  assert.equal(agentFiles.length, SYNTHETIC_AGENT_ROLES.length);
  for (const agentFile of agentFiles) {
    const contents = await readFile(join(agentDirectory, agentFile), "utf8");
    assert.equal(/^model\s*=/m.test(contents), false);
    assert.equal(/^model_reasoning_effort\s*=/m.test(contents), false);
  }
  assert.equal(SYNTHETIC_SKILL_NAMES.length, 6);
  const nestedAgent = await readFile(
    join(agentDirectory, "renma_spawn_signal_nested_worker_20260806.toml"),
    "utf8",
  );
  assert.match(nestedAgent, /\$renma-spawn-signal-nested-root-20260806/);
});

test("report and console normalization exclude content, secrets, paths, IDs, and unknown roles", () => {
  const unknownRole = "SENTINEL_UNKNOWN_ROLE_EB55A21C";
  const callerHome = "/CALLER/HOME/PRIVATE_SENTINEL";
  const apiKey = "SYNTHETIC_PRIVATE_API_KEY_SENTINEL";
  const contaminatedObservation = {
    spawnMetricObserved: true,
    spawnDataPointObserved: true,
    spawnRoleClassifications: ["allowlisted-role"],
    spawnedRoles: [unknownRole, "renma_spawn_signal_worker_20260806"],
    prompt: "PRIVATE_PROMPT",
    response: "PRIVATE_RESPONSE",
    toolOutput: "PRIVATE_TOOL_OUTPUT",
    agentId: "PRIVATE_AGENT_ID",
    path: callerHome,
    credential: apiKey,
  } as unknown as SpawnSignalObservation;
  const scenarios = exactScenarios(
    contaminatedObservation,
  ) as unknown as ScenarioSummary[];
  const report = buildExperimentReport({
    experimentDate: "2026-08-06",
    codexVersion: EXPECTED_CODEX_VERSION,
    scenarios,
  });
  const consoleSummary = buildConsoleSummary(report);
  const serialized = JSON.stringify({ report, consoleSummary });
  const prohibitedValues = [
    unknownRole,
    Buffer.from(unknownRole, "utf8").toString("base64"),
    Buffer.from(unknownRole, "utf8").toString("hex"),
    createHash("sha256").update(unknownRole).digest("hex"),
    callerHome,
    apiKey,
    "PRIVATE_PROMPT",
    "PRIVATE_RESPONSE",
    "PRIVATE_TOOL_OUTPUT",
    "PRIVATE_AGENT_ID",
  ];
  for (const value of prohibitedValues) {
    assert.equal(serialized.includes(value), false);
  }
  for (const prohibitedKey of [
    "prompt",
    "response",
    "reasoning",
    "transcript",
    "toolInput",
    "toolOutput",
    "credential",
    "path",
    "agentId",
    "threadId",
    "parentThreadId",
    "nickname",
    "experimentRunId",
    "collectorReceipt",
    "injectedSkills",
  ]) {
    assert.equal(serialized.includes(`"${prohibitedKey}"`), false);
  }
  assert.equal(
    report.authenticationIsolationMode,
    AUTHENTICATION_ISOLATION_MODE,
  );
  assert.equal(consoleSummary.allRunsCompleted, true);
  assert.equal(
    report.scenarios[0]?.runs[0]?.spawnedRoles[0],
    "renma_spawn_signal_worker_20260806",
  );
});
