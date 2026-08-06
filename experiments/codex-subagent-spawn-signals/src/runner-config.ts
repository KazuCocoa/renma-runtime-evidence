import { mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export const EXPECTED_CODEX_VERSION = "codex-cli 0.146.0";
export const REQUESTED_MODEL = "gpt-5.6-sol";
export const REQUESTED_REASONING_EFFORT = "medium";
export const RUNS_PER_SCENARIO = 3;
export const AUTHENTICATION_ISOLATION_MODE = "api-key";

export const EXECUTION_ENVIRONMENT_VARIABLES = [
  "PATH",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
] as const;

export interface RunnerArguments {
  outputPath: string;
  runs: typeof RUNS_PER_SCENARIO;
  requestedModel: typeof REQUESTED_MODEL;
  requestedReasoningEffort: typeof REQUESTED_REASONING_EFFORT;
}

export interface IsolatedRunDirectories {
  rootDirectory: string;
  workspaceDirectory: string;
  homeDirectory: string;
  codexHomeDirectory: string;
}

interface CodexInvocationOptions {
  collectorEndpoint: string;
  prompt: string;
  temporaryWorkspace: string;
  requestedModel: string;
  requestedReasoningEffort: string;
}

export function buildExecutionChildEnvironment(
  sourceEnvironment: Readonly<NodeJS.ProcessEnv>,
): NodeJS.ProcessEnv {
  const childEnvironment: NodeJS.ProcessEnv = {};
  for (const variableName of EXECUTION_ENVIRONMENT_VARIABLES) {
    const value = sourceEnvironment[variableName];
    if (value !== undefined) {
      childEnvironment[variableName] = value;
    }
  }
  return childEnvironment;
}

export function requireCodexApiKey(
  sourceEnvironment: Readonly<NodeJS.ProcessEnv>,
): string {
  const apiKey = sourceEnvironment.CODEX_API_KEY;
  if (!apiKey) {
    throw new Error("Explicit API-key authentication is required");
  }
  return apiKey;
}

export function buildExperimentChildEnvironment(
  sourceEnvironment: Readonly<NodeJS.ProcessEnv>,
  isolatedDirectories: IsolatedRunDirectories,
): NodeJS.ProcessEnv {
  return {
    ...buildExecutionChildEnvironment(sourceEnvironment),
    HOME: isolatedDirectories.homeDirectory,
    CODEX_HOME: isolatedDirectories.codexHomeDirectory,
    CODEX_API_KEY: requireCodexApiKey(sourceEnvironment),
  };
}

function isStrictDescendant(parent: string, candidate: string): boolean {
  const relativePath = relative(parent, candidate);
  return (
    relativePath.length > 0 &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  );
}

function assertIsolatedDirectoryPaths(
  isolatedDirectories: IsolatedRunDirectories,
): void {
  const locations = [
    isolatedDirectories.workspaceDirectory,
    isolatedDirectories.homeDirectory,
    isolatedDirectories.codexHomeDirectory,
  ];
  if (
    !isAbsolute(isolatedDirectories.rootDirectory) ||
    locations.some((location) => !isAbsolute(location))
  ) {
    throw new Error("Isolated locations must use absolute paths");
  }
  if (
    locations.some(
      (location) =>
        !isStrictDescendant(isolatedDirectories.rootDirectory, location),
    )
  ) {
    throw new Error("Every isolated location must be inside its run root");
  }
  if (new Set(locations).size !== locations.length) {
    throw new Error("Every isolated location must be distinct");
  }
}

export function assertExperimentChildEnvironment(
  childEnvironment: Readonly<NodeJS.ProcessEnv>,
  isolatedDirectories: IsolatedRunDirectories,
): void {
  assertIsolatedDirectoryPaths(isolatedDirectories);
  if (!childEnvironment.PATH) {
    throw new Error("The minimized child environment requires PATH");
  }
  if (!childEnvironment.CODEX_API_KEY) {
    throw new Error("The isolated child environment requires CODEX_API_KEY");
  }
  if (
    childEnvironment.HOME !== isolatedDirectories.homeDirectory ||
    childEnvironment.CODEX_HOME !== isolatedDirectories.codexHomeDirectory
  ) {
    throw new Error("Child HOME and CODEX_HOME must use isolated locations");
  }
}

export async function createIsolatedRunDirectories(
  parentDirectory = tmpdir(),
): Promise<IsolatedRunDirectories> {
  const rootDirectory = await mkdtemp(
    join(parentDirectory, "renma-spawn-signals-codex-"),
  );
  const isolatedDirectories: IsolatedRunDirectories = {
    rootDirectory,
    workspaceDirectory: join(rootDirectory, "workspace"),
    homeDirectory: join(rootDirectory, "home"),
    codexHomeDirectory: join(rootDirectory, "codex-home"),
  };

  try {
    await Promise.all(
      [
        isolatedDirectories.workspaceDirectory,
        isolatedDirectories.homeDirectory,
        isolatedDirectories.codexHomeDirectory,
      ].map((directory) => mkdir(directory, { mode: 0o700 })),
    );
    return isolatedDirectories;
  } catch (error) {
    await rm(rootDirectory, { recursive: true, force: true });
    throw error;
  }
}

export async function preflightIsolatedExperimentEnvironment(
  childEnvironment: Readonly<NodeJS.ProcessEnv>,
  isolatedDirectories: IsolatedRunDirectories,
): Promise<void> {
  assertExperimentChildEnvironment(childEnvironment, isolatedDirectories);
  const locations = [
    isolatedDirectories.workspaceDirectory,
    isolatedDirectories.homeDirectory,
    isolatedDirectories.codexHomeDirectory,
  ];
  const [locationStats, homeEntries, codexHomeEntries] = await Promise.all([
    Promise.all(locations.map((location) => stat(location))),
    readdir(isolatedDirectories.homeDirectory),
    readdir(isolatedDirectories.codexHomeDirectory),
  ]);
  if (locationStats.some((locationStat) => !locationStat.isDirectory())) {
    throw new Error("Every isolated location must be a directory");
  }
  if (homeEntries.length !== 0 || codexHomeEntries.length !== 0) {
    throw new Error("Isolated HOME and CODEX_HOME must start empty");
  }
}

export async function cleanupIsolatedRunDirectories(
  isolatedDirectories: IsolatedRunDirectories,
): Promise<void> {
  assertIsolatedDirectoryPaths(isolatedDirectories);
  await rm(isolatedDirectories.rootDirectory, { recursive: true, force: true });
}

export function parseRunnerArguments(
  args: readonly string[],
  defaultOutputPath: string,
): RunnerArguments {
  let outputPath = defaultOutputPath;
  let runs: string | undefined;
  let model: string | undefined;
  let reasoningEffort: string | undefined;
  const seenArguments = new Set<string>();

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument || seenArguments.has(argument)) {
      throw new Error("Malformed or duplicate experiment argument");
    }
    seenArguments.add(argument);
    const value = args[index + 1];
    if (!value) {
      throw new Error("Every experiment argument requires a value");
    }

    if (argument === "--runs") {
      runs = value;
    } else if (argument === "--model") {
      model = value;
    } else if (argument === "--reasoning-effort") {
      reasoningEffort = value;
    } else if (argument === "--output") {
      outputPath = resolve(value);
    } else {
      throw new Error("Unknown experiment argument");
    }
    index += 1;
  }

  if (
    runs !== String(RUNS_PER_SCENARIO) ||
    model !== REQUESTED_MODEL ||
    reasoningEffort !== REQUESTED_REASONING_EFFORT
  ) {
    throw new Error(
      "The bounded experiment requires its exact run configuration",
    );
  }

  return {
    outputPath,
    runs: RUNS_PER_SCENARIO,
    requestedModel: REQUESTED_MODEL,
    requestedReasoningEffort: REQUESTED_REASONING_EFFORT,
  };
}

export function requireExpectedCodexVersion(
  version: unknown,
): typeof EXPECTED_CODEX_VERSION {
  if (version !== EXPECTED_CODEX_VERSION) {
    throw new Error(
      "The bounded experiment requires its exact Codex CLI version",
    );
  }
  return EXPECTED_CODEX_VERSION;
}

export function buildCodexExecArguments(
  options: CodexInvocationOptions,
): string[] {
  if (
    options.requestedModel !== REQUESTED_MODEL ||
    options.requestedReasoningEffort !== REQUESTED_REASONING_EFFORT
  ) {
    throw new Error(
      "The Codex invocation requires the exact model configuration",
    );
  }
  const metricsExporter = `{ otlp-http = { endpoint = "${options.collectorEndpoint}", protocol = "json" } }`;

  return [
    "exec",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--skip-git-repo-check",
    "--enable",
    "multi_agent",
    "--model",
    REQUESTED_MODEL,
    "-C",
    options.temporaryWorkspace,
    "-c",
    `model_reasoning_effort="${REQUESTED_REASONING_EFFORT}"`,
    "-c",
    'sandbox_mode="read-only"',
    "-c",
    'approval_policy="never"',
    "-c",
    "agents.enabled=true",
    "-c",
    "otel.log_user_prompt=false",
    "-c",
    'otel.exporter="none"',
    "-c",
    'otel.trace_exporter="none"',
    "-c",
    `otel.metrics_exporter=${metricsExporter}`,
    options.prompt,
  ];
}
