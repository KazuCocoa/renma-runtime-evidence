import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createCodexSkillEvidenceCollector,
  type CodexSkillEvidenceCollector,
} from "../../../src/index.js";
import {
  buildCodexExecArguments,
  requireSupportedCodexVersion,
  type ScenarioDiagnostic,
} from "./integration-config.js";
import {
  buildCharacterizationChildEnvironment,
  buildSkillInjectedCharacterizationReport,
  CHARACTERIZATION_EXECUTION_ENVIRONMENT_VARIABLES,
  CHARACTERIZATION_SCENARIOS,
  CHARACTERIZATION_SKILLS,
  characterizationReportRequiresFailure,
  cleanupCharacterizationIsolatedDirectories,
  createCharacterizationIsolatedDirectories,
  fixedArtifactMatches,
  loadCharacterizationFixtureContents,
  parseCharacterizationRunnerArguments,
  preflightCharacterizationIsolation,
  processStatusFromDiagnostic,
  type CharacterizationFixtureContents,
  type CharacterizationIsolatedDirectories,
  type CharacterizationScenarioDefinition,
  type CharacterizationScenarioObservation,
  type SkillInjectedCharacterizationReport,
} from "./skill-injected-characterization.js";

const PREFLIGHT_TIMEOUT_MS = 10_000;
const CODEX_EXEC_TIMEOUT_MS = 180_000;
const PROCESS_TERMINATION_GRACE_MS = 1_000;
const MAX_CAPTURED_STDOUT_BYTES = 1024 * 1024;
const REQUIRED_EXEC_HELP_MARKERS = [
  "--ephemeral",
  "--ignore-user-config",
  "--ignore-rules",
  "--strict-config",
  "--sandbox",
  "--cd",
] as const;
const SAFE_ERROR_PREFIXES = [
  "Explicit Codex analytics consent required:",
  "Characterization argument error:",
  "The isolated characterization requires CODEX_API_KEY",
  "Unable to determine the installed Codex CLI version",
  "This harness requires codex-cli",
  "Characterization prerequisite failed:",
  "Unable to write the explicitly requested characterization output",
] as const;

interface BoundedProcessResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly spawnFailed: boolean;
  readonly timedOut: boolean;
  readonly captureLimitExceeded: boolean;
}

const activeChildren = new Set<ChildProcess>();
const activeCollectors = new Set<CodexSkillEvidenceCollector>();
const activeIsolatedDirectories =
  new Set<CharacterizationIsolatedDirectories>();
let cleanupPromise: Promise<void> | undefined;

function signalChild(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) {
    return;
  }
  try {
    if (process.platform === "win32") {
      child.kill(signal);
    } else {
      process.kill(-child.pid, signal);
    }
  } catch {
    try {
      child.kill(signal);
    } catch {
      // The child already exited.
    }
  }
}

function runBoundedProcess(
  command: string,
  args: readonly string[],
  options: {
    readonly cwd?: string;
    readonly environment: NodeJS.ProcessEnv;
    readonly captureStdout?: boolean;
    readonly timeoutMs: number;
  },
): Promise<BoundedProcessResult> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.environment,
      detached: process.platform !== "win32",
      stdio: ["ignore", options.captureStdout ? "pipe" : "ignore", "ignore"],
    });
    activeChildren.add(child);

    let stdout = "";
    let capturedBytes = 0;
    let spawnFailed = false;
    let timedOut = false;
    let captureLimitExceeded = false;
    let forceKillTimer: NodeJS.Timeout | undefined;

    child.stdout?.on("data", (chunk: Buffer) => {
      capturedBytes += chunk.length;
      if (capturedBytes > MAX_CAPTURED_STDOUT_BYTES) {
        captureLimitExceeded = true;
        stdout = "";
        signalChild(child, "SIGTERM");
        return;
      }
      stdout += chunk.toString("utf8");
    });
    child.once("error", () => {
      spawnFailed = true;
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      signalChild(child, "SIGTERM");
      forceKillTimer = setTimeout(() => {
        signalChild(child, "SIGKILL");
      }, PROCESS_TERMINATION_GRACE_MS);
      forceKillTimer.unref();
    }, options.timeoutMs);
    timeout.unref();

    child.once("close", (exitCode) => {
      clearTimeout(timeout);
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
      activeChildren.delete(child);
      resolvePromise({
        exitCode,
        stdout,
        spawnFailed,
        timedOut,
        captureLimitExceeded,
      });
    });
  });
}

function buildExecutionEnvironment(
  sourceEnvironment: Readonly<NodeJS.ProcessEnv>,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const variableName of CHARACTERIZATION_EXECUTION_ENVIRONMENT_VARIABLES) {
    const value = sourceEnvironment[variableName];
    if (value !== undefined) {
      environment[variableName] = value;
    }
  }
  return environment;
}

async function cleanupResources(): Promise<void> {
  cleanupPromise ??= (async () => {
    for (const child of activeChildren) {
      signalChild(child, "SIGTERM");
    }
    if (activeChildren.size > 0) {
      await new Promise<void>((resolveDelay) => {
        setTimeout(resolveDelay, PROCESS_TERMINATION_GRACE_MS);
      });
    }
    for (const child of activeChildren) {
      signalChild(child, "SIGKILL");
    }
    await Promise.allSettled(
      [...activeCollectors].map(async (collector) => {
        await collector.closeAndSnapshot();
        activeCollectors.delete(collector);
      }),
    );
    await Promise.allSettled(
      [...activeIsolatedDirectories].map(async (directories) => {
        await cleanupCharacterizationIsolatedDirectories(directories);
        activeIsolatedDirectories.delete(directories);
      }),
    );
  })();
  await cleanupPromise;
}

function installSignalCleanup(): void {
  const handleSignal = (exitCode: number) => {
    void cleanupResources().finally(() => {
      process.exit(exitCode);
    });
  };
  process.once("SIGINT", () => handleSignal(130));
  process.once("SIGTERM", () => handleSignal(143));
}

function requireSuccessfulPreflight(
  result: BoundedProcessResult,
  diagnostic: string,
): void {
  if (result.spawnFailed) {
    throw new Error(
      "Characterization prerequisite failed: the codex command was not found",
    );
  }
  if (result.timedOut) {
    throw new Error(
      `Characterization prerequisite failed: ${diagnostic} timed out`,
    );
  }
  if (result.captureLimitExceeded || result.exitCode !== 0) {
    throw new Error(
      `Characterization prerequisite failed: ${diagnostic} was unavailable`,
    );
  }
}

async function inspectCodexPrerequisites(): Promise<string> {
  if (!process.env.CODEX_API_KEY) {
    throw new Error(
      "The isolated characterization requires CODEX_API_KEY and never reuses caller HOME or CODEX_HOME",
    );
  }
  const environment = buildExecutionEnvironment(process.env);
  const versionResult = await runBoundedProcess("codex", ["--version"], {
    environment,
    captureStdout: true,
    timeoutMs: PREFLIGHT_TIMEOUT_MS,
  });
  requireSuccessfulPreflight(versionResult, "Codex version detection");
  const codexVersion = requireSupportedCodexVersion(versionResult.stdout);

  const helpResult = await runBoundedProcess("codex", ["exec", "--help"], {
    environment,
    captureStdout: true,
    timeoutMs: PREFLIGHT_TIMEOUT_MS,
  });
  requireSuccessfulPreflight(
    helpResult,
    "Codex invocation-scoped configuration",
  );
  if (
    REQUIRED_EXEC_HELP_MARKERS.some(
      (marker) => !helpResult.stdout.includes(marker),
    )
  ) {
    throw new Error(
      "Characterization prerequisite failed: the installed Codex CLI lacks required isolation flags",
    );
  }
  return codexVersion;
}

const sourceDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(sourceDirectory, "../../../..");
const fixtureRoot = join(
  repositoryRoot,
  "experiments/codex-cli-integration/fixtures",
);

async function installScenarioFixtures(
  directories: CharacterizationIsolatedDirectories,
  fixtures: CharacterizationFixtureContents,
  executionEnvironment: NodeJS.ProcessEnv,
): Promise<void> {
  const gitResult = await runBoundedProcess(
    "git",
    ["init", "--quiet", "--template="],
    {
      cwd: directories.workspaceDirectory,
      environment: executionEnvironment,
      timeoutMs: PREFLIGHT_TIMEOUT_MS,
    },
  );
  if (gitResult.spawnFailed || gitResult.timedOut || gitResult.exitCode !== 0) {
    throw new Error(
      "Characterization prerequisite failed: unable to initialize an isolated workspace",
    );
  }

  await Promise.all(
    (["target", "control"] as const).map(async (kind) => {
      const skill = CHARACTERIZATION_SKILLS[kind];
      const skillDirectory = join(
        directories.workspaceDirectory,
        ".agents/skills",
        skill.id,
      );
      await mkdir(skillDirectory, { recursive: true, mode: 0o700 });
      await writeFile(join(skillDirectory, "SKILL.md"), fixtures[kind], {
        encoding: "utf8",
        mode: 0o600,
      });
    }),
  );
}

function diagnosticForProcess(
  result: BoundedProcessResult,
): ScenarioDiagnostic | undefined {
  if (result.spawnFailed) {
    return "process-start-failed";
  }
  if (result.timedOut) {
    return "process-timeout";
  }
  if (result.exitCode !== 0) {
    return "process-exit-nonzero";
  }
  return undefined;
}

async function observeScenario(
  definition: CharacterizationScenarioDefinition,
  fixtures: CharacterizationFixtureContents,
  codexAnalyticsExplicitlyAllowed: true,
): Promise<CharacterizationScenarioObservation> {
  const directories = await createCharacterizationIsolatedDirectories();
  activeIsolatedDirectories.add(directories);
  let collector: CodexSkillEvidenceCollector | undefined;
  try {
    const childEnvironment = buildCharacterizationChildEnvironment(
      process.env,
      directories,
    );
    await preflightCharacterizationIsolation(childEnvironment, directories);
    await installScenarioFixtures(
      directories,
      fixtures,
      buildExecutionEnvironment(process.env),
    );

    collector = await createCodexSkillEvidenceCollector({
      allowedSkills: Object.values(CHARACTERIZATION_SKILLS).map(({ id }) => id),
    });
    activeCollectors.add(collector);
    const processResult = await runBoundedProcess(
      "codex",
      buildCodexExecArguments({
        collectorEndpoint: collector.endpoint,
        prompt: definition.prompt,
        temporaryRepository: directories.workspaceDirectory,
        enableMultiAgent: false,
        sandboxMode: "workspace-write",
        codexAnalyticsExplicitlyAllowed,
      }),
      {
        cwd: directories.workspaceDirectory,
        environment: childEnvironment,
        timeoutMs: CODEX_EXEC_TIMEOUT_MS,
      },
    );
    const snapshot = await collector.closeAndSnapshot();
    activeCollectors.delete(collector);
    const diagnostics = collector.diagnosticsSnapshot();
    const [targetArtifactMatched, controlArtifactMatched] = await Promise.all([
      fixedArtifactMatches(directories.workspaceDirectory, "target"),
      fixedArtifactMatches(directories.workspaceDirectory, "control"),
    ]);
    return {
      scenario: definition.id,
      processStatus: processStatusFromDiagnostic(
        diagnosticForProcess(processResult),
      ),
      targetArtifactMatched,
      controlArtifactMatched,
      snapshot,
      diagnostics,
    };
  } finally {
    if (collector) {
      await collector.closeAndSnapshot();
      activeCollectors.delete(collector);
    }
    await cleanupCharacterizationIsolatedDirectories(directories);
    activeIsolatedDirectories.delete(directories);
  }
}

function formatBoundedSummary(
  report: SkillInjectedCharacterizationReport,
): string {
  return [
    `Codex version: ${report.codexVersion}`,
    `Experiment: ${report.experiment}`,
    "Authentication isolation: api-key with fresh HOME and CODEX_HOME per scenario",
    "Collector semantics: skill-injection-presence",
    ...report.scenarios.flatMap((scenario) => [
      "",
      `${scenario.scenario}:`,
      `  requested: ${scenario.requestedSkill}`,
      `  target artifact matched: ${String(scenario.targetArtifactMatched)}`,
      `  control artifact matched: ${String(scenario.controlArtifactMatched)}`,
      `  target evidence observed: ${String(scenario.targetEvidenceObserved)}`,
      `  control evidence observed: ${String(scenario.controlEvidenceObserved)}`,
      `  unrecognized Skill evidence observed: ${String(scenario.unrecognizedSkillEvidenceObserved)}`,
      `  pipeline: ${scenario.pipelineClassification}`,
      `  classification: ${scenario.classification}`,
    ]),
    "",
    `Matrix classification: ${report.classification}`,
    "Limitations: no general availability, Skill-read, selection, execution, or instruction-compliance guarantee is claimed.",
  ].join("\n");
}

async function writeRequestedOutput(
  outputPath: string,
  serializedReport: string,
): Promise<void> {
  try {
    await writeFile(outputPath, serializedReport, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch {
    throw new Error(
      "Unable to write the explicitly requested characterization output; its parent must exist and the file must be new",
    );
  }
}

async function main(): Promise<void> {
  installSignalCleanup();
  const { codexAnalyticsExplicitlyAllowed, outputPath } =
    parseCharacterizationRunnerArguments(process.argv.slice(2));
  const [codexVersion, fixtures] = await Promise.all([
    inspectCodexPrerequisites(),
    loadCharacterizationFixtureContents(fixtureRoot),
  ]);
  const observations: CharacterizationScenarioObservation[] = [];
  for (const definition of CHARACTERIZATION_SCENARIOS) {
    observations.push(
      await observeScenario(
        definition,
        fixtures,
        codexAnalyticsExplicitlyAllowed,
      ),
    );
  }
  const report = buildSkillInjectedCharacterizationReport({
    codexVersion,
    codexAnalyticsExplicitlyAllowed,
    observations,
  });
  const serializedReport = `${JSON.stringify(report, null, 2)}\n`;
  process.stderr.write(`${formatBoundedSummary(report)}\n`);
  process.stdout.write(serializedReport);
  if (outputPath) {
    await writeRequestedOutput(outputPath, serializedReport);
    process.stderr.write(
      "Bounded characterization report written to the explicitly requested destination.\n",
    );
  }
  if (characterizationReportRequiresFailure(report)) {
    process.exitCode = 1;
  }
}

try {
  await main();
} catch (error) {
  const message =
    error instanceof Error &&
    SAFE_ERROR_PREFIXES.some((prefix) => error.message.startsWith(prefix))
      ? error.message
      : "The skill.injected characterization failed before a privacy-safe report could be produced";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
} finally {
  await cleanupResources();
}
