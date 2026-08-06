import { mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export const EXECUTION_ENVIRONMENT_VARIABLES = [
  "PATH",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
] as const;

export const AUTHENTICATION_ENVIRONMENT_VARIABLES = ["CODEX_API_KEY"] as const;

export const ISOLATED_LOCATION_ENVIRONMENT_VARIABLES = [
  "HOME",
  "CODEX_HOME",
] as const;

export const AUTHENTICATION_ISOLATION_MODE = "api-key" as const;

export const SUPPORTED_REASONING_EFFORTS = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

export type SupportedReasoningEffort =
  (typeof SUPPORTED_REASONING_EFFORTS)[number];

export interface RequestedModelConfiguration {
  requestedModel: string;
  requestedReasoningEffort: SupportedReasoningEffort;
}

export interface RunnerArguments extends RequestedModelConfiguration {
  outputPath: string;
  runs: number;
}

export interface IsolatedRunDirectories {
  rootDirectory: string;
  workspaceDirectory: string;
  homeDirectory: string;
  codexHomeDirectory: string;
}

interface CodexInvocationOptions extends RequestedModelConfiguration {
  collectorEndpoint: string;
  prompt: string;
  temporaryWorkspace: string;
}

const supportedReasoningEfforts: ReadonlySet<string> = new Set(
  SUPPORTED_REASONING_EFFORTS,
);
const modelIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

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

export function buildExperimentChildEnvironment(
  sourceEnvironment: Readonly<NodeJS.ProcessEnv>,
  isolatedDirectories: IsolatedRunDirectories,
): NodeJS.ProcessEnv {
  const childEnvironment = buildExecutionChildEnvironment(sourceEnvironment);
  const apiKey = requireCodexApiKey(sourceEnvironment);

  childEnvironment.HOME = isolatedDirectories.homeDirectory;
  childEnvironment.CODEX_HOME = isolatedDirectories.codexHomeDirectory;
  childEnvironment.CODEX_API_KEY = apiKey;

  return childEnvironment;
}

export function requireCodexApiKey(
  sourceEnvironment: Readonly<NodeJS.ProcessEnv>,
): string {
  const apiKey = sourceEnvironment.CODEX_API_KEY;
  if (!apiKey) {
    throw new Error(
      "The isolated experiment requires CODEX_API_KEY; implicit saved-login authentication and caller HOME/CODEX_HOME reuse are prohibited",
    );
  }
  return apiKey;
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
  const {
    rootDirectory,
    workspaceDirectory,
    homeDirectory,
    codexHomeDirectory,
  } = isolatedDirectories;

  if (
    !isAbsolute(rootDirectory) ||
    !isAbsolute(workspaceDirectory) ||
    !isAbsolute(homeDirectory) ||
    !isAbsolute(codexHomeDirectory)
  ) {
    throw new Error("Isolated experiment directories must use absolute paths");
  }
  if (
    !isStrictDescendant(rootDirectory, workspaceDirectory) ||
    !isStrictDescendant(rootDirectory, homeDirectory) ||
    !isStrictDescendant(rootDirectory, codexHomeDirectory)
  ) {
    throw new Error(
      "Workspace, HOME, and CODEX_HOME must be contained by the per-run isolation root",
    );
  }
  if (
    new Set([workspaceDirectory, homeDirectory, codexHomeDirectory]).size !== 3
  ) {
    throw new Error(
      "Workspace, HOME, and CODEX_HOME must be distinct isolated directories",
    );
  }
}

export function assertExperimentChildEnvironment(
  childEnvironment: Readonly<NodeJS.ProcessEnv>,
  isolatedDirectories: IsolatedRunDirectories,
): void {
  if (!childEnvironment.PATH) {
    throw new Error(
      "The minimized experiment environment requires PATH to locate Codex and system executables",
    );
  }
  if (!childEnvironment.CODEX_API_KEY) {
    throw new Error(
      "The isolated experiment environment requires explicit CODEX_API_KEY authentication",
    );
  }

  assertIsolatedDirectoryPaths(isolatedDirectories);
  if (
    childEnvironment.HOME !== isolatedDirectories.homeDirectory ||
    childEnvironment.CODEX_HOME !== isolatedDirectories.codexHomeDirectory
  ) {
    throw new Error(
      "Experiment HOME and CODEX_HOME must exactly match the per-run isolated directories",
    );
  }
}

export async function createIsolatedRunDirectories(
  parentDirectory = tmpdir(),
): Promise<IsolatedRunDirectories> {
  const rootDirectory = await mkdtemp(
    join(parentDirectory, "renma-skill-topology-codex-"),
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

  const directories = [
    isolatedDirectories.workspaceDirectory,
    isolatedDirectories.homeDirectory,
    isolatedDirectories.codexHomeDirectory,
  ];
  const [directoryStats, homeEntries, codexHomeEntries] = await Promise.all([
    Promise.all(directories.map((directory) => stat(directory))),
    readdir(isolatedDirectories.homeDirectory),
    readdir(isolatedDirectories.codexHomeDirectory),
  ]);

  if (directoryStats.some((directoryStat) => !directoryStat.isDirectory())) {
    throw new Error("Every isolated run location must be a directory");
  }
  if (homeEntries.length > 0 || codexHomeEntries.length > 0) {
    throw new Error(
      "Isolated HOME and CODEX_HOME must be empty before the Codex invocation",
    );
  }
}

export async function cleanupIsolatedRunDirectories(
  isolatedDirectories: IsolatedRunDirectories,
): Promise<void> {
  assertIsolatedDirectoryPaths(isolatedDirectories);
  await rm(isolatedDirectories.rootDirectory, { recursive: true, force: true });
}

function isModelIdentifier(value: unknown): value is string {
  return typeof value === "string" && modelIdentifierPattern.test(value);
}

function isSupportedReasoningEffort(
  value: unknown,
): value is SupportedReasoningEffort {
  return typeof value === "string" && supportedReasoningEfforts.has(value);
}

export function normalizeRequestedModelConfiguration(
  model: unknown,
  reasoningEffort: unknown,
): RequestedModelConfiguration {
  if (!isModelIdentifier(model)) {
    throw new Error(
      "--model must be an explicit identifier containing only letters, numbers, dots, underscores, colons, slashes, or hyphens",
    );
  }
  if (!isSupportedReasoningEffort(reasoningEffort)) {
    throw new Error(
      `--reasoning-effort must be one of: ${SUPPORTED_REASONING_EFFORTS.join(", ")}`,
    );
  }

  return {
    requestedModel: model,
    requestedReasoningEffort: reasoningEffort,
  };
}

export function parseRunnerArguments(
  args: readonly string[],
  defaultOutputPath: string,
): RunnerArguments {
  let outputPath = defaultOutputPath;
  let runs = 3;
  let model: string | undefined;
  let reasoningEffort: string | undefined;
  const seenArguments = new Set<string>();

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument) {
      throw new Error("Experiment arguments must be non-empty strings");
    }
    if (seenArguments.has(argument)) {
      throw new Error(`Duplicate argument: ${argument}`);
    }

    if (argument === "--runs") {
      seenArguments.add(argument);
      const value = Number(args[index + 1]);
      if (!Number.isInteger(value) || value < 3 || value > 10) {
        throw new Error("--runs must be an integer from 3 to 10");
      }
      runs = value;
      index += 1;
    } else if (argument === "--output") {
      seenArguments.add(argument);
      const value = args[index + 1];
      if (!value) {
        throw new Error("--output requires a path");
      }
      outputPath = resolve(value);
      index += 1;
    } else if (argument === "--model") {
      seenArguments.add(argument);
      model = args[index + 1];
      index += 1;
    } else if (argument === "--reasoning-effort") {
      seenArguments.add(argument);
      reasoningEffort = args[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (model === undefined) {
    throw new Error("--model is required");
  }
  if (reasoningEffort === undefined) {
    throw new Error("--reasoning-effort is required");
  }

  return {
    outputPath,
    runs,
    ...normalizeRequestedModelConfiguration(model, reasoningEffort),
  };
}

export function buildCodexExecArguments(
  options: CodexInvocationOptions,
): string[] {
  const modelConfiguration = normalizeRequestedModelConfiguration(
    options.requestedModel,
    options.requestedReasoningEffort,
  );
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
    modelConfiguration.requestedModel,
    "-C",
    options.temporaryWorkspace,
    "-c",
    `model_reasoning_effort="${modelConfiguration.requestedReasoningEffort}"`,
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
