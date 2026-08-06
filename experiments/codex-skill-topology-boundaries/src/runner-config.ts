import { resolve } from "node:path";

export const EXECUTION_ENVIRONMENT_VARIABLES = [
  "PATH",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
] as const;

export const AUTHENTICATION_ENVIRONMENT_VARIABLES = [
  "HOME",
  "CODEX_HOME",
  "CODEX_API_KEY",
] as const;

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
): NodeJS.ProcessEnv {
  const childEnvironment = buildExecutionChildEnvironment(sourceEnvironment);

  for (const variableName of AUTHENTICATION_ENVIRONMENT_VARIABLES) {
    const value = sourceEnvironment[variableName];
    if (value !== undefined) {
      childEnvironment[variableName] = value;
    }
  }

  return childEnvironment;
}

export function assertExperimentChildEnvironment(
  childEnvironment: Readonly<NodeJS.ProcessEnv>,
): void {
  if (!childEnvironment.PATH) {
    throw new Error(
      "The minimized experiment environment requires PATH to locate Codex and system executables",
    );
  }

  if (
    !childEnvironment.HOME &&
    !childEnvironment.CODEX_HOME &&
    !childEnvironment.CODEX_API_KEY
  ) {
    throw new Error(
      "The minimized experiment environment has no explicit Codex authentication source; configure HOME, CODEX_HOME, or CODEX_API_KEY",
    );
  }
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
