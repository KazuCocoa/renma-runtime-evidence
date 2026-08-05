import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { arch, platform, release, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  EXPERIMENT_ID,
  SCENARIO_IDS,
  SYNTHETIC_SKILL_NAMES,
  TARGET_METRIC_NAME,
  type ScenarioId,
  type SkillPresenceSet,
  type SyntheticSkillName,
} from "./allowlist.js";
import { startLocalCollector } from "./collector.js";

const EXPLICIT_SINGLE_SKILL =
  "renma-activation-explicit-single-20260805" satisfies SyntheticSkillName;
const EXPLICIT_ALPHA_SKILL =
  "renma-activation-explicit-alpha-20260805" satisfies SyntheticSkillName;
const EXPLICIT_BETA_SKILL =
  "renma-activation-explicit-beta-20260805" satisfies SyntheticSkillName;
const ROUTER_SKILL =
  "renma-activation-router-20260805" satisfies SyntheticSkillName;

interface ScenarioDefinition {
  id: ScenarioId;
  prompt: string;
}

interface RunSummary extends SkillPresenceSet {
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
  exportedMetric: typeof TARGET_METRIC_NAME;
  runsPerScenario: number;
  scenarios: ScenarioSummary[];
}

const scenarioDefinitions: readonly ScenarioDefinition[] = [
  {
    id: "discovered-only",
    prompt:
      "Return exactly PLAIN_CONTROL_20260805. Do not use a Skill, inspect files, or call tools.",
  },
  {
    id: "explicit-single",
    prompt: `Use $${EXPLICIT_SINGLE_SKILL}. Return only the synthetic acknowledgement required by that Skill.`,
  },
  {
    id: "explicit-multiple",
    prompt: `Use $${EXPLICIT_ALPHA_SKILL} and $${EXPLICIT_BETA_SKILL}. Return only MULTI_CONTROL_20260805.`,
  },
  {
    id: "router-to-target",
    prompt: `Use $${ROUTER_SKILL}. Return only the synthetic acknowledgement required by that Skill.`,
  },
  {
    id: "implicit-match",
    prompt:
      "Produce the synthetic seal RAX-IMPLICIT-7Q9 using its dedicated procedure. Return only the resulting seal.",
  },
];

if (
  scenarioDefinitions.length !== SCENARIO_IDS.length ||
  scenarioDefinitions.some(
    (definition, index) => definition.id !== SCENARIO_IDS[index],
  )
) {
  throw new Error(
    "Scenario definitions must exactly match the scenario allowlist",
  );
}

const sourceDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(sourceDirectory, "../../../..");
const fixtureRoot = join(
  repositoryRoot,
  "experiments/codex-skill-activation-paths/fixtures",
);
const defaultOutputPath = join(
  repositoryRoot,
  "experiments/codex-skill-activation-paths/.local/experiment-report.json",
);

function runProcess(
  command: string,
  args: string[],
  options: { cwd?: string; captureStdout?: boolean } = {},
): Promise<{ exitCode: number | null; stdout: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
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
): Promise<string | undefined> {
  const result = await runProcess(command, args, { captureStdout: true });
  const output = result.stdout.trim();
  return result.exitCode === 0 && output ? output : undefined;
}

async function readExperimentEnvironment(): Promise<ExperimentEnvironment> {
  const codexVersion = await readCommandOutput("codex", ["--version"]);
  if (!codexVersion || !/^codex-cli \d+\.\d+\.\d+/.test(codexVersion)) {
    throw new Error("Unable to determine the installed Codex version");
  }

  let operatingSystem = `${platform()} ${release()}`;
  if (platform() === "darwin") {
    const [productVersion, buildVersion] = await Promise.all([
      readCommandOutput("sw_vers", ["-productVersion"]),
      readCommandOutput("sw_vers", ["-buildVersion"]),
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

function readArguments(): { outputPath: string; runs: number } {
  let outputPath = defaultOutputPath;
  let runs = 3;

  for (let index = 2; index < process.argv.length; index += 1) {
    const argument = process.argv[index];
    if (argument === "--runs") {
      const value = Number(process.argv[index + 1]);
      if (!Number.isInteger(value) || value < 3 || value > 10) {
        throw new Error("--runs must be an integer from 3 to 10");
      }
      runs = value;
      index += 1;
    } else if (argument === "--output") {
      const value = process.argv[index + 1];
      if (!value) {
        throw new Error("--output requires a path");
      }
      outputPath = resolve(value);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return { outputPath, runs };
}

async function readFixtures(): Promise<Map<SyntheticSkillName, string>> {
  const entries = await Promise.all(
    SYNTHETIC_SKILL_NAMES.map(async (skillName) => {
      const contents = await readFile(
        join(fixtureRoot, skillName, "SKILL.md"),
        "utf8",
      );
      return [skillName, contents] as const;
    }),
  );
  return new Map(entries);
}

async function installFixtures(
  temporaryWorkspace: string,
  fixtures: ReadonlyMap<SyntheticSkillName, string>,
): Promise<void> {
  await Promise.all(
    SYNTHETIC_SKILL_NAMES.map(async (skillName) => {
      const fixtureContents = fixtures.get(skillName);
      if (!fixtureContents) {
        throw new Error(`Missing synthetic fixture: ${skillName}`);
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

async function runOnce(
  definition: ScenarioDefinition,
  fixtures: ReadonlyMap<SyntheticSkillName, string>,
): Promise<RunSummary> {
  const experimentRunId = randomUUID();
  const temporaryWorkspace = await mkdtemp(
    join(tmpdir(), "renma-activation-paths-codex-"),
  );
  const collector = await startLocalCollector(definition.id);

  try {
    await installFixtures(temporaryWorkspace, fixtures);

    const metricsExporter = `{ otlp-http = { endpoint = "${collector.endpoint}", protocol = "json" } }`;
    const result = await runProcess(
      "codex",
      [
        "exec",
        "--ephemeral",
        "--ignore-user-config",
        "--skip-git-repo-check",
        "-C",
        temporaryWorkspace,
        "-c",
        'sandbox_mode="read-only"',
        "-c",
        'approval_policy="never"',
        "-c",
        "otel.log_user_prompt=false",
        "-c",
        'otel.exporter="none"',
        "-c",
        'otel.trace_exporter="none"',
        "-c",
        `otel.metrics_exporter=${metricsExporter}`,
        definition.prompt,
      ],
      { cwd: temporaryWorkspace },
    );

    return {
      schemaVersion: 1,
      provider: "codex",
      experiment: EXPERIMENT_ID,
      scenario: definition.id,
      experimentRunId,
      codexExitCode: result.exitCode,
      ...collector.snapshot(),
    };
  } finally {
    try {
      await collector.close();
    } finally {
      await rm(temporaryWorkspace, { recursive: true, force: true });
    }
  }
}

async function main(): Promise<void> {
  const { outputPath, runs } = readArguments();
  const [environment, fixtures] = await Promise.all([
    readExperimentEnvironment(),
    readFixtures(),
  ]);
  const scenarios: ScenarioSummary[] = [];

  for (const definition of scenarioDefinitions) {
    const runSummaries: RunSummary[] = [];
    for (let index = 0; index < runs; index += 1) {
      runSummaries.push(await runOnce(definition, fixtures));
    }
    scenarios.push({ scenario: definition.id, runs: runSummaries });
  }

  const report: ExperimentReport = {
    schemaVersion: 1,
    experimentDate: new Date().toISOString().slice(0, 10),
    environment,
    provider: "codex",
    experiment: EXPERIMENT_ID,
    exportedMetric: TARGET_METRIC_NAME,
    runsPerScenario: runs,
    scenarios,
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const observedRunsByScenario = Object.fromEntries(
    scenarios.map(({ scenario, runs: scenarioRuns }) => [
      scenario,
      scenarioRuns.filter((run) => run.injectedSkills.length > 0).length,
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
      exportedMetric: report.exportedMetric,
      runsPerScenario: report.runsPerScenario,
      observedRunsByScenario,
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
