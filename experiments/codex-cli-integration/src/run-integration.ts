import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createCodexSkillEvidenceCollector,
  type CodexSkillEvidenceCollector,
} from "../../../src/index.js";
import {
  buildCodexExecArguments,
  buildIntegrationReport,
  buildScenarioResult,
  FIXTURE_AGENT_ROLE,
  FIXTURE_SKILL_IDS,
  formatConsoleSummary,
  formatDiagnosticsSummary,
  formatDirectBaselineSummary,
  observeIndependentCollectorRuns,
  parseRunnerArguments,
  reportRequiresFailure,
  requireSupportedCodexVersion,
  SCENARIO_DEFINITIONS,
  type ScenarioDefinition,
  type ScenarioDiagnostic,
  type IntegrationObservations,
  type ScenarioObservation,
} from "./integration-config.js";

const PREFLIGHT_TIMEOUT_MS = 10_000;
const CODEX_EXEC_TIMEOUT_MS = 180_000;
const PROCESS_TERMINATION_GRACE_MS = 1_000;
const MAX_CAPTURED_STDOUT_BYTES = 1024 * 1024;
const TEMPORARY_PREFIX = "renma-runtime-evidence-codex-integration-";
const REQUIRED_EXEC_HELP_MARKERS = [
  "--ephemeral",
  "--ignore-user-config",
  "--ignore-rules",
  "--strict-config",
  "--sandbox",
  "--cd",
] as const;
const SAFE_ERROR_PREFIXES = [
  "Usage:",
  "Explicit Codex analytics consent required:",
  "Integration argument error:",
  "Scenario configuration error:",
  "Unable to determine the installed Codex CLI version",
  "This harness requires codex-cli",
  "Collector endpoint must be",
  "Temporary repository path must be",
  "Collector returned",
  "Codex Skill evidence collector",
  "Prerequisite failed:",
  "A synthetic Skill fixture",
  "The synthetic custom-agent fixture",
  "Unable to initialize the temporary fixture repository",
  "Unable to write the explicitly requested output destination",
] as const;

interface BoundedProcessResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly spawnFailed: boolean;
  readonly timedOut: boolean;
  readonly captureLimitExceeded: boolean;
}

interface FixtureContents {
  readonly skills: ReadonlyMap<string, string>;
  readonly agent?: string;
}

interface TemporaryFixtureRepository {
  readonly rootDirectory: string;
  readonly repositoryDirectory: string;
}

const activeChildren = new Set<ChildProcess>();
const activeCollectors = new Set<CodexSkillEvidenceCollector>();
let activeTemporaryRoot: string | undefined;
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
      // The process already exited.
    }
  }
}

function runBoundedProcess(
  command: string,
  args: readonly string[],
  options: {
    readonly cwd?: string;
    readonly captureStdout?: boolean;
    readonly environment?: NodeJS.ProcessEnv;
    readonly timeoutMs: number;
  },
): Promise<BoundedProcessResult> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.environment ?? process.env,
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

function isStrictTemporaryRoot(candidate: string): boolean {
  const relativePath = relative(resolve(tmpdir()), resolve(candidate));
  return (
    relativePath !== "" &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${sep}`) &&
    !relativePath.includes(sep) &&
    basename(candidate).startsWith(TEMPORARY_PREFIX)
  );
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

    if (activeTemporaryRoot && isStrictTemporaryRoot(activeTemporaryRoot)) {
      await rm(activeTemporaryRoot, { recursive: true, force: true });
      activeTemporaryRoot = undefined;
    }
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
    throw new Error("Prerequisite failed: the codex command was not found");
  }
  if (result.timedOut) {
    throw new Error(`Prerequisite failed: ${diagnostic} timed out`);
  }
  if (result.captureLimitExceeded || result.exitCode !== 0) {
    throw new Error(`Prerequisite failed: ${diagnostic} was unavailable`);
  }
}

async function inspectCodexPrerequisites(): Promise<{
  codexVersion: string;
  multiAgentAvailable: boolean;
}> {
  const versionResult = await runBoundedProcess("codex", ["--version"], {
    captureStdout: true,
    timeoutMs: PREFLIGHT_TIMEOUT_MS,
  });
  requireSuccessfulPreflight(versionResult, "Codex version detection");
  const codexVersion = requireSupportedCodexVersion(versionResult.stdout);

  const helpResult = await runBoundedProcess("codex", ["exec", "--help"], {
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
      "Prerequisite failed: the installed Codex CLI lacks required invocation-scoped isolation flags",
    );
  }

  const authenticationResult = await runBoundedProcess(
    "codex",
    ["login", "status"],
    { timeoutMs: PREFLIGHT_TIMEOUT_MS },
  );
  if (
    authenticationResult.spawnFailed ||
    authenticationResult.timedOut ||
    authenticationResult.exitCode !== 0
  ) {
    throw new Error(
      "Prerequisite failed: Codex authentication is unavailable; authenticate with the normal codex login flow and retry",
    );
  }

  const featuresResult = await runBoundedProcess(
    "codex",
    ["features", "list"],
    { captureStdout: true, timeoutMs: PREFLIGHT_TIMEOUT_MS },
  );
  const multiAgentMatch = /^multi_agent\s+(\S+)/mu.exec(featuresResult.stdout);
  const multiAgentAvailable =
    !featuresResult.spawnFailed &&
    !featuresResult.timedOut &&
    !featuresResult.captureLimitExceeded &&
    featuresResult.exitCode === 0 &&
    multiAgentMatch?.[1] !== undefined &&
    multiAgentMatch[1] !== "removed";

  return { codexVersion, multiAgentAvailable };
}

const sourceDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(sourceDirectory, "../../../..");
const fixtureRoot = join(
  repositoryRoot,
  "experiments/codex-cli-integration/fixtures",
);

async function readFixtureContents(
  directOnly: boolean,
): Promise<FixtureContents> {
  const requestedSkillIds = directOnly
    ? [FIXTURE_SKILL_IDS.direct]
    : Object.values(FIXTURE_SKILL_IDS);
  const skillEntries = await Promise.all(
    requestedSkillIds.map(async (skillId) => {
      const contents = await readFile(
        join(fixtureRoot, "skills", skillId, "SKILL.md"),
        "utf8",
      );
      if (!contents.includes(`\nname: ${skillId}\n`)) {
        throw new Error("A synthetic Skill fixture has an invalid name");
      }
      return [skillId, contents] as const;
    }),
  );
  if (directOnly) {
    return { skills: new Map(skillEntries) };
  }
  const agent = await readFile(
    join(fixtureRoot, "agents", `${FIXTURE_AGENT_ROLE}.toml`),
    "utf8",
  );
  if (!agent.includes(`name = "${FIXTURE_AGENT_ROLE}"`)) {
    throw new Error("The synthetic custom-agent fixture has an invalid name");
  }
  return { skills: new Map(skillEntries), agent };
}

async function createTemporaryFixtureRepository(
  fixtures: FixtureContents,
): Promise<TemporaryFixtureRepository> {
  const rootDirectory = await mkdtemp(join(tmpdir(), TEMPORARY_PREFIX));
  activeTemporaryRoot = rootDirectory;
  const repositoryDirectory = join(rootDirectory, "repository");
  await mkdir(repositoryDirectory, { mode: 0o700 });

  const gitResult = await runBoundedProcess(
    "git",
    ["init", "--quiet", "--template="],
    {
      cwd: repositoryDirectory,
      environment: Object.fromEntries(
        ["PATH", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "LC_CTYPE"]
          .map((name) => [name, process.env[name]])
          .filter((entry): entry is [string, string] => entry[1] !== undefined),
      ),
      timeoutMs: PREFLIGHT_TIMEOUT_MS,
    },
  );
  if (gitResult.spawnFailed || gitResult.timedOut || gitResult.exitCode !== 0) {
    throw new Error("Unable to initialize the temporary fixture repository");
  }

  await Promise.all(
    [...fixtures.skills].map(async ([skillId, contents]) => {
      const skillDirectory = join(
        repositoryDirectory,
        ".agents/skills",
        skillId,
      );
      await mkdir(skillDirectory, { recursive: true, mode: 0o700 });
      await writeFile(join(skillDirectory, "SKILL.md"), contents, {
        encoding: "utf8",
        mode: 0o600,
      });
    }),
  );

  if (fixtures.agent !== undefined) {
    const agentDirectory = join(repositoryDirectory, ".codex/agents");
    await mkdir(agentDirectory, { recursive: true, mode: 0o700 });
    await writeFile(
      join(agentDirectory, `${FIXTURE_AGENT_ROLE}.toml`),
      fixtures.agent,
      { encoding: "utf8", mode: 0o600 },
    );
  }

  return { rootDirectory, repositoryDirectory };
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
  definition: ScenarioDefinition,
  temporaryRepository: string,
  multiAgentAvailable: boolean,
  codexAnalyticsExplicitlyAllowed: true,
): Promise<ScenarioObservation[]> {
  if (definition.requiresMultiAgent && !multiAgentAvailable) {
    return definition.prompts.map(() => ({
      diagnostic: "multi-agent-unavailable",
    }));
  }

  return observeIndependentCollectorRuns({
    allowedSkills: definition.allowedSkills,
    prompts: definition.prompts,
    createCollector: async (allowedSkills) => {
      const collector = await createCodexSkillEvidenceCollector({
        allowedSkills,
      });
      activeCollectors.add(collector);
      return {
        endpoint: collector.endpoint,
        diagnosticsSnapshot: () => collector.diagnosticsSnapshot(),
        closeAndSnapshot: async () => {
          try {
            return await collector.closeAndSnapshot();
          } finally {
            activeCollectors.delete(collector);
          }
        },
      };
    },
    runCodex: async ({ collectorEndpoint, prompt }) => {
      const result = await runBoundedProcess(
        "codex",
        buildCodexExecArguments({
          collectorEndpoint,
          prompt,
          temporaryRepository,
          enableMultiAgent: definition.requiresMultiAgent,
          codexAnalyticsExplicitlyAllowed,
        }),
        {
          cwd: temporaryRepository,
          timeoutMs: CODEX_EXEC_TIMEOUT_MS,
        },
      );
      return diagnosticForProcess(result);
    },
  });
}

function requireSingleObservation(
  scenario: "direct" | "nested" | "subagent",
  observations: readonly ScenarioObservation[],
): ScenarioObservation {
  const observation = observations[0];
  if (observations.length !== 1 || !observation) {
    throw new Error(
      `Scenario configuration error: ${scenario} requires one collector lifetime`,
    );
  }
  return observation;
}

function requireRepeatedObservations(
  observations: readonly ScenarioObservation[],
): readonly [ScenarioObservation, ScenarioObservation] {
  const first = observations[0];
  const second = observations[1];
  if (observations.length !== 2 || !first || !second) {
    throw new Error(
      "Scenario configuration error: repeated requires two independent collector lifetimes",
    );
  }
  return [first, second];
}

async function writeRequestedOutput(
  outputPath: string,
  serializedOutput: string,
): Promise<void> {
  try {
    await writeFile(resolve(outputPath), serializedOutput, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch {
    throw new Error(
      "Unable to write the explicitly requested output destination; its parent must exist and the file must be new",
    );
  }
}

async function main(): Promise<void> {
  installSignalCleanup();
  const { outputPath, codexAnalyticsExplicitlyAllowed, directOnly } =
    parseRunnerArguments(process.argv.slice(2));
  const [{ codexVersion, multiAgentAvailable }, fixtures] = await Promise.all([
    inspectCodexPrerequisites(),
    readFixtureContents(directOnly),
  ]);
  const temporaryFixture = await createTemporaryFixtureRepository(fixtures);

  const scenarioObservations = new Map<
    ScenarioDefinition["id"],
    ScenarioObservation[]
  >();
  const directDefinition = SCENARIO_DEFINITIONS.find(
    (definition) => definition.id === "direct",
  );
  if (!directDefinition) {
    throw new Error(
      "Scenario configuration error: direct scenario is required",
    );
  }
  scenarioObservations.set(
    "direct",
    await observeScenario(
      directDefinition,
      temporaryFixture.repositoryDirectory,
      multiAgentAvailable,
      codexAnalyticsExplicitlyAllowed,
    ),
  );
  const directObservation = requireSingleObservation(
    "direct",
    scenarioObservations.get("direct") ?? [],
  );

  if (directOnly) {
    if (!directObservation.snapshot) {
      throw new Error("Collector returned no public evidence snapshot");
    }
    const serializedSnapshot = `${JSON.stringify(
      directObservation.snapshot,
      null,
      2,
    )}\n`;
    process.stderr.write(
      `${formatDirectBaselineSummary({ codexVersion, observation: directObservation })}\n`,
    );
    process.stdout.write(serializedSnapshot);
    if (outputPath) {
      await writeRequestedOutput(outputPath, serializedSnapshot);
      process.stderr.write(
        "Public evidence snapshot written to the explicitly requested destination.\n",
      );
    }
    if (buildScenarioResult("direct", directObservation).status === "failed") {
      process.exitCode = 1;
    }
    return;
  }

  for (const definition of SCENARIO_DEFINITIONS.filter(
    (candidate) => candidate.id !== "direct",
  )) {
    scenarioObservations.set(
      definition.id,
      await observeScenario(
        definition,
        temporaryFixture.repositoryDirectory,
        multiAgentAvailable,
        codexAnalyticsExplicitlyAllowed,
      ),
    );
  }

  const observations: IntegrationObservations = {
    direct: directObservation,
    repeated: requireRepeatedObservations(
      scenarioObservations.get("repeated") ?? [],
    ),
    nested: requireSingleObservation(
      "nested",
      scenarioObservations.get("nested") ?? [],
    ),
    subagent: requireSingleObservation(
      "subagent",
      scenarioObservations.get("subagent") ?? [],
    ),
  };
  const report = buildIntegrationReport({
    codexVersion,
    codexAnalyticsExplicitlyAllowed,
    observations,
  });
  const serializedReport = `${JSON.stringify(report, null, 2)}\n`;
  process.stderr.write(
    `${formatConsoleSummary(report)}\n\n${formatDiagnosticsSummary(observations)}\n`,
  );
  process.stdout.write(serializedReport);
  if (outputPath) {
    await writeRequestedOutput(outputPath, serializedReport);
    process.stderr.write(
      "Machine-readable report written to the explicitly requested destination.\n",
    );
  }
  if (reportRequiresFailure(report)) {
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
      : "The Codex integration experiment failed before a privacy-safe report could be produced";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
} finally {
  await cleanupResources();
}
