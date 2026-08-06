import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { startLocalCollector, type LocalCollector } from "./collector.js";
import {
  AUTHENTICATION_ISOLATION_MODE,
  buildCodexExecArguments,
  buildExperimentChildEnvironment,
  buildExecutionChildEnvironment,
  cleanupIsolatedRunDirectories,
  createIsolatedRunDirectories,
  EXPECTED_CODEX_VERSION,
  parseRunnerArguments,
  preflightIsolatedExperimentEnvironment,
  REQUESTED_MODEL,
  REQUESTED_REASONING_EFFORT,
  requireCodexApiKey,
  requireExpectedCodexVersion,
  RUNS_PER_SCENARIO,
} from "./runner-config.js";
import {
  EXPERIMENT_ID,
  mergeSpawnSignalObservations,
  normalizeSpawnSignalObservation,
  SCENARIO_IDS,
  SYNTHETIC_AGENT_ROLES,
  SYNTHETIC_SKILL_NAMES,
  type ScenarioId,
  type SpawnSignalObservation,
  type SyntheticAgentRole,
  type SyntheticSkillName,
} from "./signals.js";

const DORMANT_ORCHESTRATOR =
  "renma-spawn-signal-orchestrator-dormant-20260806" satisfies SyntheticSkillName;
const SINGLE_ORCHESTRATOR =
  "renma-spawn-signal-orchestrator-single-20260806" satisfies SyntheticSkillName;
const NESTED_ORCHESTRATOR =
  "renma-spawn-signal-orchestrator-nested-20260806" satisfies SyntheticSkillName;
const PARALLEL_ORCHESTRATOR =
  "renma-spawn-signal-orchestrator-parallel-20260806" satisfies SyntheticSkillName;

export interface ScenarioDefinition {
  id: ScenarioId;
  prompt: string;
}

export interface RunSummary extends SpawnSignalObservation {
  schemaVersion: 1;
  provider: "codex";
  experiment: typeof EXPERIMENT_ID;
  scenario: ScenarioId;
  codexExitCode: 0;
}

export interface ScenarioSummary {
  scenario: ScenarioId;
  runs: RunSummary[];
}

export interface ExperimentReport {
  schemaVersion: 1;
  experimentDate: string;
  provider: "codex";
  experiment: typeof EXPERIMENT_ID;
  environment: { codexVersion: typeof EXPECTED_CODEX_VERSION };
  modelConfiguration: {
    requestedModel: typeof REQUESTED_MODEL;
    requestedReasoningEffort: typeof REQUESTED_REASONING_EFFORT;
  };
  authenticationIsolationMode: typeof AUTHENTICATION_ISOLATION_MODE;
  runsPerScenario: typeof RUNS_PER_SCENARIO;
  scenarios: ScenarioSummary[];
}

export interface ExperimentConsoleSummary {
  provider: "codex";
  experiment: typeof EXPERIMENT_ID;
  environment: { codexVersion: typeof EXPECTED_CODEX_VERSION };
  modelConfiguration: {
    requestedModel: typeof REQUESTED_MODEL;
    requestedReasoningEffort: typeof REQUESTED_REASONING_EFFORT;
  };
  authenticationIsolationMode: typeof AUTHENTICATION_ISOLATION_MODE;
  runsPerScenario: typeof RUNS_PER_SCENARIO;
  scenarioObservations: Record<string, SpawnSignalObservation>;
  allRunsCompleted: boolean;
}

interface ExperimentFixtures {
  skills: ReadonlyMap<SyntheticSkillName, string>;
  agents: ReadonlyMap<SyntheticAgentRole, string>;
}

export const CODEX_EXEC_STDIO = ["ignore", "ignore", "ignore"] as const;

export const SCENARIO_DEFINITIONS: readonly ScenarioDefinition[] = [
  {
    id: "custom-agents-dormant",
    prompt: `Use $${DORMANT_ORCHESTRATOR}. Return only the synthetic acknowledgement required by that Skill.`,
  },
  {
    id: "single-custom-agent",
    prompt: `Use $${SINGLE_ORCHESTRATOR}. Return only the synthetic acknowledgement required by that Skill.`,
  },
  {
    id: "nested-custom-agent",
    prompt: `Use $${NESTED_ORCHESTRATOR}. Return only the synthetic acknowledgement required by that Skill.`,
  },
  {
    id: "parallel-custom-agents",
    prompt: `Use $${PARALLEL_ORCHESTRATOR}. Return only the synthetic acknowledgement required by that Skill.`,
  },
];

if (
  SCENARIO_DEFINITIONS.length !== SCENARIO_IDS.length ||
  SCENARIO_DEFINITIONS.some(
    (definition, index) => definition.id !== SCENARIO_IDS[index],
  )
) {
  throw new Error("Scenario definitions must match the finite allowlist");
}

const sourceDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(sourceDirectory, "../../../..");
const experimentDirectory = join(
  repositoryRoot,
  "experiments/codex-subagent-spawn-signals",
);
const fixtureRoot = join(experimentDirectory, "fixtures");
const defaultOutputPath = join(
  experimentDirectory,
  ".local/experiment-report.json",
);

export function buildExperimentReport(options: {
  experimentDate: string;
  codexVersion: typeof EXPECTED_CODEX_VERSION;
  scenarios: readonly ScenarioSummary[];
}): ExperimentReport {
  return {
    schemaVersion: 1,
    experimentDate: options.experimentDate,
    provider: "codex",
    experiment: EXPERIMENT_ID,
    environment: { codexVersion: options.codexVersion },
    modelConfiguration: {
      requestedModel: REQUESTED_MODEL,
      requestedReasoningEffort: REQUESTED_REASONING_EFFORT,
    },
    authenticationIsolationMode: AUTHENTICATION_ISOLATION_MODE,
    runsPerScenario: RUNS_PER_SCENARIO,
    scenarios: options.scenarios.map(({ scenario, runs }) => ({
      scenario,
      runs: runs.map((run) => ({
        schemaVersion: 1,
        provider: "codex",
        experiment: EXPERIMENT_ID,
        scenario: run.scenario,
        codexExitCode: 0,
        ...normalizeSpawnSignalObservation(run),
      })),
    })),
  };
}

export function buildConsoleSummary(
  report: ExperimentReport,
): ExperimentConsoleSummary {
  return {
    provider: report.provider,
    experiment: report.experiment,
    environment: { codexVersion: report.environment.codexVersion },
    modelConfiguration: {
      requestedModel: report.modelConfiguration.requestedModel,
      requestedReasoningEffort:
        report.modelConfiguration.requestedReasoningEffort,
    },
    authenticationIsolationMode: report.authenticationIsolationMode,
    runsPerScenario: report.runsPerScenario,
    scenarioObservations: Object.fromEntries(
      report.scenarios.map(({ scenario, runs }) => [
        scenario,
        mergeSpawnSignalObservations(runs),
      ]),
    ),
    allRunsCompleted: report.scenarios.every(({ runs }) =>
      runs.every((run) => run.codexExitCode === 0),
    ),
  };
}

function runIgnoredProcess(
  command: string,
  args: string[],
  options: { environment: NodeJS.ProcessEnv; cwd: string },
): Promise<number | null> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.environment,
      stdio: [...CODEX_EXEC_STDIO],
    });
    child.once("error", reject);
    child.once("close", resolvePromise);
  });
}

function readCommandOutput(
  command: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
): Promise<string | undefined> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      env: environment,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.once("error", reject);
    child.once("close", (exitCode) => {
      const output = stdout.trim();
      resolvePromise(exitCode === 0 && output ? output : undefined);
    });
  });
}

async function readFixtures(): Promise<ExperimentFixtures> {
  const skillEntries = await Promise.all(
    SYNTHETIC_SKILL_NAMES.map(async (skillName) => {
      const contents = await readFile(
        join(fixtureRoot, "skills", skillName, "SKILL.md"),
        "utf8",
      );
      if (!contents.includes(`\nname: ${skillName}\n`)) {
        throw new Error("Synthetic Skill fixture name mismatch");
      }
      return [skillName, contents] as const;
    }),
  );
  const agentEntries = await Promise.all(
    SYNTHETIC_AGENT_ROLES.map(async (role) => {
      const contents = await readFile(
        join(fixtureRoot, "agents", `${role}.toml`),
        "utf8",
      );
      if (!contents.includes(`name = "${role}"`)) {
        throw new Error("Synthetic custom-agent fixture name mismatch");
      }
      return [role, contents] as const;
    }),
  );
  return { skills: new Map(skillEntries), agents: new Map(agentEntries) };
}

async function installFixtures(
  workspaceDirectory: string,
  fixtures: ExperimentFixtures,
): Promise<void> {
  await Promise.all(
    SYNTHETIC_SKILL_NAMES.map(async (skillName) => {
      const contents = fixtures.skills.get(skillName);
      if (!contents) {
        throw new Error("Missing synthetic Skill fixture");
      }
      const skillDirectory = join(
        workspaceDirectory,
        ".agents/skills",
        skillName,
      );
      await mkdir(skillDirectory, { recursive: true });
      await writeFile(join(skillDirectory, "SKILL.md"), contents, "utf8");
    }),
  );

  const agentDirectory = join(workspaceDirectory, ".codex/agents");
  await mkdir(agentDirectory, { recursive: true });
  await Promise.all(
    SYNTHETIC_AGENT_ROLES.map(async (role) => {
      const contents = fixtures.agents.get(role);
      if (!contents) {
        throw new Error("Missing synthetic custom-agent fixture");
      }
      await writeFile(join(agentDirectory, `${role}.toml`), contents, "utf8");
    }),
  );
}

async function runOnce(
  definition: ScenarioDefinition,
  fixtures: ExperimentFixtures,
  sourceEnvironment: NodeJS.ProcessEnv,
): Promise<RunSummary> {
  const isolatedDirectories = await createIsolatedRunDirectories();
  let collector: LocalCollector | undefined;

  try {
    const childEnvironment = buildExperimentChildEnvironment(
      sourceEnvironment,
      isolatedDirectories,
    );
    await preflightIsolatedExperimentEnvironment(
      childEnvironment,
      isolatedDirectories,
    );
    await installFixtures(isolatedDirectories.workspaceDirectory, fixtures);
    collector = await startLocalCollector();

    const exitCode = await runIgnoredProcess(
      "codex",
      buildCodexExecArguments({
        collectorEndpoint: collector.endpoint,
        prompt: definition.prompt,
        temporaryWorkspace: isolatedDirectories.workspaceDirectory,
        requestedModel: REQUESTED_MODEL,
        requestedReasoningEffort: REQUESTED_REASONING_EFFORT,
      }),
      {
        cwd: isolatedDirectories.workspaceDirectory,
        environment: childEnvironment,
      },
    );
    if (exitCode !== 0) {
      throw new Error("Codex invocation did not complete successfully");
    }

    const observation = await collector.closeAndSnapshot();
    return {
      schemaVersion: 1,
      provider: "codex",
      experiment: EXPERIMENT_ID,
      scenario: definition.id,
      codexExitCode: 0,
      ...observation,
    };
  } finally {
    try {
      await collector?.closeAndSnapshot();
    } finally {
      await cleanupIsolatedRunDirectories(isolatedDirectories);
    }
  }
}

async function main(): Promise<void> {
  const runnerArguments = parseRunnerArguments(
    process.argv.slice(2),
    defaultOutputPath,
  );
  const apiKey = requireCodexApiKey(process.env);
  const executionEnvironment = buildExecutionChildEnvironment(process.env);
  const version = requireExpectedCodexVersion(
    await readCommandOutput("codex", ["--version"], executionEnvironment),
  );
  const fixtures = await readFixtures();
  const sourceEnvironment = { ...executionEnvironment, CODEX_API_KEY: apiKey };
  const scenarios: ScenarioSummary[] = [];

  for (const definition of SCENARIO_DEFINITIONS) {
    const runs: RunSummary[] = [];
    for (let run = 0; run < runnerArguments.runs; run += 1) {
      runs.push(await runOnce(definition, fixtures, sourceEnvironment));
    }
    scenarios.push({ scenario: definition.id, runs });
  }

  const report = buildExperimentReport({
    experimentDate: new Date().toISOString().slice(0, 10),
    codexVersion: version,
    scenarios,
  });
  await mkdir(dirname(runnerArguments.outputPath), { recursive: true });
  await writeFile(
    runnerArguments.outputPath,
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write(`${JSON.stringify(buildConsoleSummary(report))}\n`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await main();
  } catch {
    process.stderr.write(
      "Experiment did not complete; no new runtime evidence was written.\n",
    );
    process.exitCode = 1;
  }
}
