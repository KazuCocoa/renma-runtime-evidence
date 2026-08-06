import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { arch, platform, release, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  EXPERIMENT_ID,
  PHASE_A_SCENARIO_IDS,
  SCENARIO_IDS,
  SYNTHETIC_AGENT_ROLES,
  SYNTHETIC_SKILL_NAMES,
  type RuntimePresenceSet,
  type ScenarioId,
  type SyntheticAgentRole,
  type SyntheticSkillName,
} from "./allowlist.js";
import { startLocalCollector, type LocalCollector } from "./collector.js";
import {
  assertExperimentChildEnvironment,
  buildCodexExecArguments,
  buildExperimentChildEnvironment,
  buildExecutionChildEnvironment,
  normalizeRequestedModelConfiguration,
  parseRunnerArguments,
  type RequestedModelConfiguration,
} from "./runner-config.js";

const DEPTH_2_ROOT =
  "renma-topology-depth2-root-20260806" satisfies SyntheticSkillName;
const DEPTH_3_ROOT =
  "renma-topology-depth3-root-20260806" satisfies SyntheticSkillName;
const BRANCH_ROOT =
  "renma-topology-branch-root-20260806" satisfies SyntheticSkillName;
const DIAMOND_ROOT =
  "renma-topology-diamond-root-20260806" satisfies SyntheticSkillName;
const DORMANT_ORCHESTRATOR =
  "renma-topology-orchestrator-dormant-20260806" satisfies SyntheticSkillName;
const SINGLE_ORCHESTRATOR =
  "renma-topology-orchestrator-single-20260806" satisfies SyntheticSkillName;
const CHAIN_ORCHESTRATOR =
  "renma-topology-orchestrator-chain-20260806" satisfies SyntheticSkillName;
const PARALLEL_ORCHESTRATOR =
  "renma-topology-orchestrator-parallel-20260806" satisfies SyntheticSkillName;

interface ScenarioDefinition {
  id: ScenarioId;
  installCustomAgents: boolean;
  prompt: string;
}

interface RunSummary extends RuntimePresenceSet {
  schemaVersion: 1;
  provider: "codex";
  experiment: typeof EXPERIMENT_ID;
  scenario: ScenarioId;
  experimentRunId: string;
  codexExitCode: number | null;
}

interface ScenarioSummary {
  scenario: ScenarioId;
  runs: RunSummary[];
}

interface ExperimentEnvironment {
  codexVersion: string;
  operatingSystem: string;
  architecture: string;
  nodeVersion: string;
}

interface ExperimentReport {
  schemaVersion: 1;
  experimentDate: string;
  environment: ExperimentEnvironment;
  provider: "codex";
  experiment: typeof EXPERIMENT_ID;
  modelConfiguration: RequestedModelConfiguration;
  runsPerScenario: number;
  scenarios: ScenarioSummary[];
}

interface ExperimentFixtures {
  skills: ReadonlyMap<SyntheticSkillName, string>;
  agents: ReadonlyMap<SyntheticAgentRole, string>;
}

const scenarioDefinitions: readonly ScenarioDefinition[] = [
  {
    id: "nested-chain-depth-2",
    installCustomAgents: false,
    prompt: `Use $${DEPTH_2_ROOT}. Return only the synthetic acknowledgement required by that Skill.`,
  },
  {
    id: "nested-chain-depth-3",
    installCustomAgents: false,
    prompt: `Use $${DEPTH_3_ROOT}. Return only the synthetic acknowledgement required by that Skill.`,
  },
  {
    id: "nested-branch",
    installCustomAgents: false,
    prompt: `Use $${BRANCH_ROOT}. Return only the synthetic acknowledgement required by that Skill.`,
  },
  {
    id: "nested-diamond",
    installCustomAgents: false,
    prompt: `Use $${DIAMOND_ROOT}. Return only the synthetic acknowledgement required by that Skill.`,
  },
  {
    id: "subagent-config-dormant",
    installCustomAgents: true,
    prompt: `Use $${DORMANT_ORCHESTRATOR}. Return only the synthetic acknowledgement required by that Skill.`,
  },
  {
    id: "subagent-single-skill",
    installCustomAgents: true,
    prompt: `Use $${SINGLE_ORCHESTRATOR}. Return only the synthetic acknowledgement required by that Skill.`,
  },
  {
    id: "subagent-nested-chain",
    installCustomAgents: true,
    prompt: `Use $${CHAIN_ORCHESTRATOR}. Return only the synthetic acknowledgement required by that Skill.`,
  },
  {
    id: "subagent-parallel",
    installCustomAgents: true,
    prompt: `Use $${PARALLEL_ORCHESTRATOR}. Return only the synthetic acknowledgement required by that Skill.`,
  },
];

if (
  scenarioDefinitions.length !== SCENARIO_IDS.length ||
  scenarioDefinitions.some(
    (definition, index) => definition.id !== SCENARIO_IDS[index],
  )
) {
  throw new Error(
    "Scenario definitions must exactly match the finite scenario allowlist",
  );
}

const phaseAScenarioIds: ReadonlySet<ScenarioId> = new Set(
  PHASE_A_SCENARIO_IDS,
);
if (
  scenarioDefinitions.some(
    (definition) =>
      definition.installCustomAgents === phaseAScenarioIds.has(definition.id),
  )
) {
  throw new Error("Only Phase B scenarios may install custom-agent fixtures");
}

const sourceDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(sourceDirectory, "../../../..");
const fixtureRoot = join(
  repositoryRoot,
  "experiments/codex-skill-topology-boundaries/fixtures",
);
const defaultOutputPath = join(
  repositoryRoot,
  "experiments/codex-skill-topology-boundaries/.local/experiment-report.json",
);

function runProcess(
  command: string,
  args: string[],
  options: {
    environment: NodeJS.ProcessEnv;
    cwd?: string;
    captureStdout?: boolean;
  },
): Promise<{ exitCode: number | null; stdout: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.environment,
      stdio: ["ignore", options.captureStdout ? "pipe" : "ignore", "ignore"],
    });
    let stdout = "";

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.once("error", reject);
    child.once("close", (exitCode) => resolvePromise({ exitCode, stdout }));
  });
}

async function readCommandOutput(
  command: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
): Promise<string | undefined> {
  const result = await runProcess(command, args, {
    captureStdout: true,
    environment,
  });
  const output = result.stdout.trim();
  return result.exitCode === 0 && output ? output : undefined;
}

async function verifyCodexAuthentication(
  childEnvironment: NodeJS.ProcessEnv,
): Promise<"api-key" | "saved-login"> {
  if (childEnvironment.CODEX_API_KEY) {
    return "api-key";
  }

  let result: { exitCode: number | null; stdout: string };
  try {
    result = await runProcess("codex", ["login", "status"], {
      environment: childEnvironment,
    });
  } catch (error) {
    throw new Error(
      "Unable to check Codex authentication with the minimized child environment; the runner will not broaden the forwarded variables",
      { cause: error },
    );
  }
  if (result.exitCode !== 0) {
    throw new Error(
      "Codex saved authentication is unavailable through the forwarded HOME or CODEX_HOME under the minimized child environment; the runner will not broaden the forwarded variables",
    );
  }

  return "saved-login";
}

async function readExperimentEnvironment(
  executionEnvironment: NodeJS.ProcessEnv,
): Promise<ExperimentEnvironment> {
  const codexVersion = await readCommandOutput(
    "codex",
    ["--version"],
    executionEnvironment,
  );
  if (!codexVersion || !/^codex-cli \d+\.\d+\.\d+/.test(codexVersion)) {
    throw new Error("Unable to determine the installed Codex version");
  }

  let operatingSystem = `${platform()} ${release()}`;
  if (platform() === "darwin") {
    const [productVersion, buildVersion] = await Promise.all([
      readCommandOutput("sw_vers", ["-productVersion"], executionEnvironment),
      readCommandOutput("sw_vers", ["-buildVersion"], executionEnvironment),
    ]);
    if (productVersion && buildVersion) {
      operatingSystem = `macOS ${productVersion} (${buildVersion})`;
    }
  }

  return {
    codexVersion,
    operatingSystem,
    architecture: arch(),
    nodeVersion: process.version,
  };
}

async function readFixtures(): Promise<ExperimentFixtures> {
  const skillEntries = await Promise.all(
    SYNTHETIC_SKILL_NAMES.map(async (skillName) => {
      const contents = await readFile(
        join(fixtureRoot, "skills", skillName, "SKILL.md"),
        "utf8",
      );
      if (!contents.includes(`\nname: ${skillName}\n`)) {
        throw new Error(`Synthetic Skill fixture has wrong name: ${skillName}`);
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
        throw new Error(
          `Synthetic custom-agent fixture has wrong name: ${role}`,
        );
      }
      return [role, contents] as const;
    }),
  );

  return {
    skills: new Map(skillEntries),
    agents: new Map(agentEntries),
  };
}

async function installSkillFixtures(
  temporaryWorkspace: string,
  fixtures: ReadonlyMap<SyntheticSkillName, string>,
): Promise<void> {
  await Promise.all(
    SYNTHETIC_SKILL_NAMES.map(async (skillName) => {
      const fixtureContents = fixtures.get(skillName);
      if (!fixtureContents) {
        throw new Error(`Missing synthetic Skill fixture: ${skillName}`);
      }

      const skillDirectory = join(
        temporaryWorkspace,
        ".agents/skills",
        skillName,
      );
      await mkdir(skillDirectory, { recursive: true });
      await writeFile(
        join(skillDirectory, "SKILL.md"),
        fixtureContents,
        "utf8",
      );
    }),
  );
}

async function installCustomAgentFixtures(
  temporaryWorkspace: string,
  fixtures: ReadonlyMap<SyntheticAgentRole, string>,
): Promise<void> {
  const agentDirectory = join(temporaryWorkspace, ".codex/agents");
  await mkdir(agentDirectory, { recursive: true });

  await Promise.all(
    SYNTHETIC_AGENT_ROLES.map(async (role) => {
      const fixtureContents = fixtures.get(role);
      if (!fixtureContents) {
        throw new Error(`Missing synthetic custom-agent fixture: ${role}`);
      }
      await writeFile(
        join(agentDirectory, `${role}.toml`),
        fixtureContents,
        "utf8",
      );
    }),
  );
}

async function runOnce(
  definition: ScenarioDefinition,
  fixtures: ExperimentFixtures,
  modelConfiguration: RequestedModelConfiguration,
  childEnvironment: NodeJS.ProcessEnv,
  authenticationRoute: "api-key" | "saved-login",
): Promise<RunSummary> {
  const experimentRunId = randomUUID();
  const temporaryWorkspace = await mkdtemp(
    join(tmpdir(), "renma-skill-topology-codex-"),
  );
  let collector: LocalCollector | undefined;

  try {
    collector = await startLocalCollector(definition.id);
    await installSkillFixtures(temporaryWorkspace, fixtures.skills);
    if (definition.installCustomAgents) {
      await installCustomAgentFixtures(temporaryWorkspace, fixtures.agents);
    }

    let result: { exitCode: number | null; stdout: string };
    try {
      result = await runProcess(
        "codex",
        buildCodexExecArguments({
          collectorEndpoint: collector.endpoint,
          prompt: definition.prompt,
          temporaryWorkspace,
          ...modelConfiguration,
        }),
        {
          cwd: temporaryWorkspace,
          environment: childEnvironment,
        },
      );
    } catch (error) {
      throw new Error(
        `Unable to start Codex for scenario ${definition.id} with the minimized child environment; the runner will not broaden the forwarded variables`,
        { cause: error },
      );
    }
    if (result.exitCode !== 0) {
      throw new Error(
        `Codex for scenario ${definition.id} exited with status ${String(result.exitCode)} under the minimized environment using the explicit ${authenticationRoute} authentication route. The requested model, configuration, network, or authentication may be unavailable; the runner will not broaden the forwarded variables`,
      );
    }
    const presence = await collector.closeAndSnapshot();

    return {
      schemaVersion: 1,
      provider: "codex",
      experiment: EXPERIMENT_ID,
      scenario: definition.id,
      experimentRunId,
      codexExitCode: result.exitCode,
      ...presence,
    };
  } finally {
    try {
      await collector?.closeAndSnapshot();
    } finally {
      await rm(temporaryWorkspace, { recursive: true, force: true });
    }
  }
}

async function main(): Promise<void> {
  const { outputPath, runs, requestedModel, requestedReasoningEffort } =
    parseRunnerArguments(process.argv.slice(2), defaultOutputPath);
  const modelConfiguration = normalizeRequestedModelConfiguration(
    requestedModel,
    requestedReasoningEffort,
  );
  const executionEnvironment = buildExecutionChildEnvironment(process.env);
  const codexEnvironment = buildExperimentChildEnvironment(process.env);
  assertExperimentChildEnvironment(codexEnvironment);
  const [authenticationRoute, environment, fixtures] = await Promise.all([
    verifyCodexAuthentication(codexEnvironment),
    readExperimentEnvironment(executionEnvironment),
    readFixtures(),
  ]);
  const scenarios: ScenarioSummary[] = [];

  for (const definition of scenarioDefinitions) {
    const runSummaries: RunSummary[] = [];
    for (let index = 0; index < runs; index += 1) {
      runSummaries.push(
        await runOnce(
          definition,
          fixtures,
          modelConfiguration,
          codexEnvironment,
          authenticationRoute,
        ),
      );
    }
    scenarios.push({ scenario: definition.id, runs: runSummaries });
  }

  const report: ExperimentReport = {
    schemaVersion: 1,
    experimentDate: new Date().toISOString().slice(0, 10),
    environment,
    provider: "codex",
    experiment: EXPERIMENT_ID,
    modelConfiguration,
    runsPerScenario: runs,
    scenarios,
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const scenarioPresence = Object.fromEntries(
    scenarios.map(({ scenario, runs: scenarioRuns }) => [
      scenario,
      {
        runsWithSkills: scenarioRuns.filter(
          (run) => run.injectedSkills.length > 0,
        ).length,
        runsWithRoles: scenarioRuns.filter((run) => run.spawnedRoles.length > 0)
          .length,
      },
    ]),
  );
  const failedRuns = scenarios
    .flatMap(({ runs: scenarioRuns }) => scenarioRuns)
    .filter((run) => run.codexExitCode !== 0).length;
  process.stdout.write(
    `${JSON.stringify({
      experimentDate: report.experimentDate,
      environment: report.environment,
      provider: report.provider,
      experiment: report.experiment,
      modelConfiguration: report.modelConfiguration,
      runsPerScenario: report.runsPerScenario,
      scenarioPresence,
      failedRuns,
    })}\n`,
  );

  if (failedRuns > 0) {
    process.stderr.write(
      `Experiment incomplete: ${failedRuns} Codex process(es) did not exit successfully.\n`,
    );
    process.exitCode = 1;
  }
}

await main();
