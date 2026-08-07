import { isAbsolute } from "node:path";

import type {
  CodexSkillEvidenceDiagnosticsSnapshot,
  CodexSkillPresenceSnapshot,
} from "../../../src/index.js";

export const FIXTURE_SKILL_IDS = {
  direct: "renma-integration-direct-20260806",
  nestedParent: "renma-integration-nested-parent-20260806",
  nestedChild: "renma-integration-nested-child-20260806",
  subagentParent: "renma-integration-subagent-parent-20260806",
  subagentChild: "renma-integration-subagent-child-20260806",
} as const;

export const FIXTURE_AGENT_ROLE = "renma_integration_worker_20260806" as const;

export const SCENARIO_IDS = [
  "direct",
  "repeated",
  "nested",
  "subagent",
] as const;

export type ScenarioId = (typeof SCENARIO_IDS)[number];
export type ScenarioStatus =
  "supported" | "inconclusive" | "unsupported" | "failed";
export type ScenarioDiagnostic =
  | "direct-label-not-observed"
  | "repeated-label-not-observed"
  | "nested-label-not-observed"
  | "subagent-label-not-observed"
  | "multi-agent-unavailable"
  | "process-start-failed"
  | "process-timeout"
  | "process-exit-nonzero";

export interface ScenarioDefinition {
  readonly id: ScenarioId;
  readonly allowedSkills: readonly string[];
  readonly prompts: readonly string[];
  readonly requiresMultiAgent: boolean;
}

const scenarioDefinitions: Record<ScenarioId, ScenarioDefinition> = {
  direct: {
    id: "direct",
    allowedSkills: [FIXTURE_SKILL_IDS.direct],
    prompts: [
      `Use $${FIXTURE_SKILL_IDS.direct}. Return only the synthetic acknowledgement required by that Skill.`,
    ],
    requiresMultiAgent: false,
  },
  repeated: {
    id: "repeated",
    allowedSkills: [FIXTURE_SKILL_IDS.direct],
    prompts: [
      `Use $${FIXTURE_SKILL_IDS.direct}. Return only the synthetic acknowledgement required by that Skill.`,
      `Use $${FIXTURE_SKILL_IDS.direct}. Return only the synthetic acknowledgement required by that Skill.`,
    ],
    requiresMultiAgent: false,
  },
  nested: {
    id: "nested",
    allowedSkills: [
      FIXTURE_SKILL_IDS.nestedParent,
      FIXTURE_SKILL_IDS.nestedChild,
    ],
    prompts: [
      `Use $${FIXTURE_SKILL_IDS.nestedParent}. Return only the synthetic acknowledgement required by that Skill.`,
    ],
    requiresMultiAgent: false,
  },
  subagent: {
    id: "subagent",
    allowedSkills: [
      FIXTURE_SKILL_IDS.subagentParent,
      FIXTURE_SKILL_IDS.subagentChild,
    ],
    prompts: [
      `Use $${FIXTURE_SKILL_IDS.subagentParent}. Return only the synthetic acknowledgement required by that Skill.`,
    ],
    requiresMultiAgent: true,
  },
};

export const SCENARIO_DEFINITIONS: readonly ScenarioDefinition[] =
  SCENARIO_IDS.map((scenarioId) => scenarioDefinitions[scenarioId]);

export interface RunnerArguments {
  readonly codexAnalyticsExplicitlyAllowed: true;
  readonly directOnly: boolean;
  readonly outputPath?: string;
}

export const CODEX_ANALYTICS_CONSENT_MESSAGE =
  "Explicit Codex analytics consent required: Codex gates the configured OTel metrics exporter behind analytics.enabled; enabling it may send separate Codex analytics events to OpenAI, and the loopback OTel metrics endpoint does not control that separate path. Re-run with --allow-codex-analytics.";

const MINIMUM_CODEX_VERSION = [0, 146, 0] as const;

export function requireSupportedCodexVersion(output: string): string {
  const match = /^codex-cli (\d+)\.(\d+)\.(\d+)$/u.exec(output.trim());
  if (!match) {
    throw new Error("Unable to determine the installed Codex CLI version");
  }
  const version = match.slice(1).map(Number);
  for (let index = 0; index < MINIMUM_CODEX_VERSION.length; index += 1) {
    const actual = version[index];
    const minimum = MINIMUM_CODEX_VERSION[index];
    if (actual === undefined || minimum === undefined) {
      throw new Error("Unable to determine the installed Codex CLI version");
    }
    if (actual > minimum) {
      return output.trim();
    }
    if (actual < minimum) {
      throw new Error(
        "This harness requires codex-cli 0.146.0 or newer with repository-local Skills and invocation-scoped OTel metrics configuration",
      );
    }
  }
  return output.trim();
}

export interface CodexInvocationOptions {
  readonly collectorEndpoint: string;
  readonly prompt: string;
  readonly temporaryRepository: string;
  readonly enableMultiAgent: boolean;
  readonly sandboxMode?: "read-only" | "workspace-write";
  readonly codexAnalyticsExplicitlyAllowed: true;
}

interface BaseScenarioResult {
  readonly status: ScenarioStatus;
  readonly observedSkillIds: readonly string[];
  readonly unrecognizedSkillObserved: boolean;
  readonly diagnostic?: ScenarioDiagnostic;
}

export interface DirectScenarioResult extends BaseScenarioResult {}

export interface RepeatedRunResult extends BaseScenarioResult {
  readonly status: "supported" | "failed";
}

export interface RepeatedScenarioResult {
  readonly status: "supported" | "failed";
  readonly runs: readonly [RepeatedRunResult, RepeatedRunResult];
}

export interface NestedScenarioResult extends BaseScenarioResult {
  readonly runtimeEdgeClaimed: false;
}

export interface SubagentScenarioResult extends BaseScenarioResult {
  readonly agentAttributionClaimed: false;
}

export interface IntegrationReport {
  readonly schemaVersion: 1;
  readonly provider: "codex";
  readonly codexVersion: string;
  readonly exportedMetric: "codex.skill.injected";
  readonly codexAnalyticsExplicitlyAllowed: true;
  readonly collectorSemantics: "presence";
  readonly observationScope: "collector-lifetime";
  readonly scenarios: {
    readonly direct: DirectScenarioResult;
    readonly repeated: RepeatedScenarioResult;
    readonly nested: NestedScenarioResult;
    readonly subagent: SubagentScenarioResult;
  };
  readonly limitations: {
    readonly skillExecutionClaimed: false;
    readonly orderingClaimed: false;
    readonly sessionAttributionClaimed: false;
    readonly nestingEdgeClaimed: false;
    readonly agentAttributionClaimed: false;
    readonly instructionComplianceClaimed: false;
    readonly taskSuccessClaimed: false;
  };
}

export interface ScenarioObservation {
  readonly snapshot?: CodexSkillPresenceSnapshot;
  readonly diagnostics?: CodexSkillEvidenceDiagnosticsSnapshot;
  readonly diagnostic?: ScenarioDiagnostic;
}

export interface IntegrationObservations {
  readonly direct: ScenarioObservation;
  readonly repeated: readonly [ScenarioObservation, ScenarioObservation];
  readonly nested: ScenarioObservation;
  readonly subagent: ScenarioObservation;
}

export interface IndependentObservationCollector {
  readonly endpoint: string;
  diagnosticsSnapshot(): CodexSkillEvidenceDiagnosticsSnapshot;
  closeAndSnapshot(): Promise<CodexSkillPresenceSnapshot>;
}

export async function observeIndependentCollectorRuns(options: {
  readonly allowedSkills: readonly string[];
  readonly prompts: readonly string[];
  readonly createCollector: (
    allowedSkills: readonly string[],
  ) => Promise<IndependentObservationCollector>;
  readonly runCodex: (options: {
    readonly collectorEndpoint: string;
    readonly prompt: string;
  }) => Promise<ScenarioDiagnostic | undefined>;
}): Promise<ScenarioObservation[]> {
  const observations: ScenarioObservation[] = [];
  for (const prompt of options.prompts) {
    const collector = await options.createCollector(options.allowedSkills);
    let diagnostic: ScenarioDiagnostic | undefined;
    try {
      diagnostic = await options.runCodex({
        collectorEndpoint: collector.endpoint,
        prompt,
      });
      const snapshot = await collector.closeAndSnapshot();
      const diagnostics = collector.diagnosticsSnapshot();
      const observation: {
        snapshot: CodexSkillPresenceSnapshot;
        diagnostics: CodexSkillEvidenceDiagnosticsSnapshot;
        diagnostic?: ScenarioDiagnostic;
      } = { snapshot, diagnostics };
      if (diagnostic) {
        observation.diagnostic = diagnostic;
      }
      observations.push(observation);
    } finally {
      await collector.closeAndSnapshot();
    }
  }
  return observations;
}

export function parseRunnerArguments(args: readonly string[]): RunnerArguments {
  let codexAnalyticsExplicitlyAllowed = false;
  let directOnly = false;
  let outputPath: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--allow-codex-analytics") {
      if (codexAnalyticsExplicitlyAllowed) {
        throw new Error(
          "Integration argument error: duplicate --allow-codex-analytics",
        );
      }
      codexAnalyticsExplicitlyAllowed = true;
    } else if (argument === "--direct-only") {
      if (directOnly) {
        throw new Error("Integration argument error: duplicate --direct-only");
      }
      directOnly = true;
    } else if (argument === "--output") {
      if (outputPath !== undefined) {
        throw new Error("Integration argument error: duplicate --output");
      }
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("Integration argument error: --output requires a path");
      }
      outputPath = value;
      index += 1;
    } else {
      throw new Error("Integration argument error: unknown option");
    }
  }

  if (!codexAnalyticsExplicitlyAllowed) {
    throw new Error(CODEX_ANALYTICS_CONSENT_MESSAGE);
  }

  const result: {
    codexAnalyticsExplicitlyAllowed: true;
    directOnly: boolean;
    outputPath?: string;
  } = { codexAnalyticsExplicitlyAllowed: true, directOnly };
  if (outputPath !== undefined) {
    result.outputPath = outputPath;
  }
  return result;
}

export type PipelineClassification =
  | "no-otlp-request"
  | "request-decode-failure"
  | "decoded-without-metric-datapoints"
  | "non-target-metric-datapoints-only"
  | "target-datapoints-rejected"
  | "accepted-skill-evidence";

export function classifyPipelineDiagnostics(
  diagnostics: CodexSkillEvidenceDiagnosticsSnapshot,
): PipelineClassification {
  if (diagnostics.otlpMetricsRequestsReceived === 0) {
    return "no-otlp-request";
  }
  if (diagnostics.successfullyDecodedRequests === 0) {
    return "request-decode-failure";
  }
  if (diagnostics.acceptedAllowlistedSkillDataPoints > 0) {
    return "accepted-skill-evidence";
  }
  if (diagnostics.targetDataPointsObserved > 0) {
    return "target-datapoints-rejected";
  }
  if (diagnostics.metricDataPointsInspected > 0) {
    return "non-target-metric-datapoints-only";
  }
  return "decoded-without-metric-datapoints";
}

function requireLoopbackMetricsEndpoint(endpoint: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error("Collector endpoint must be a loopback OTLP metrics URL");
  }
  if (
    parsed.protocol !== "http:" ||
    parsed.hostname !== "127.0.0.1" ||
    parsed.pathname !== "/v1/metrics" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.port === ""
  ) {
    throw new Error("Collector endpoint must be a loopback OTLP metrics URL");
  }
  return parsed;
}

export function buildCodexExecArguments(
  options: CodexInvocationOptions,
): string[] {
  if (options.codexAnalyticsExplicitlyAllowed !== true) {
    throw new Error(CODEX_ANALYTICS_CONSENT_MESSAGE);
  }
  const collectorEndpoint = requireLoopbackMetricsEndpoint(
    options.collectorEndpoint,
  ).toString();
  if (!isAbsolute(options.temporaryRepository)) {
    throw new Error("Temporary repository path must be absolute");
  }
  const metricsExporter = `{ otlp-http = { endpoint = "${collectorEndpoint}", protocol = "json" } }`;
  const multiAgentArguments = options.enableMultiAgent
    ? ["--enable", "multi_agent", "-c", "agents.enabled=true"]
    : [];

  return [
    "exec",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--strict-config",
    "--color",
    "never",
    "--sandbox",
    options.sandboxMode ?? "read-only",
    ...multiAgentArguments,
    "-C",
    options.temporaryRepository,
    "-c",
    'approval_policy="never"',
    "-c",
    "analytics.enabled=true",
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

function normalizeObservation(
  scenarioId: ScenarioId,
  observation: ScenarioObservation,
): {
  observedSkillIds: string[];
  unrecognizedSkillObserved: boolean;
} {
  const snapshot = observation.snapshot;
  if (!snapshot) {
    return {
      observedSkillIds: [],
      unrecognizedSkillObserved: false,
    };
  }
  if (
    snapshot.schemaVersion !== 1 ||
    snapshot.provider !== "codex" ||
    snapshot.signal !== "skill-injected" ||
    snapshot.observationScope !== "collector-lifetime"
  ) {
    throw new Error("Collector returned unsupported public evidence semantics");
  }
  const allowedSkills = new Set(scenarioDefinitions[scenarioId].allowedSkills);
  if (snapshot.injectedSkills.some((skill) => !allowedSkills.has(skill))) {
    throw new Error(
      "Collector returned a Skill outside the scenario allowlist",
    );
  }
  return {
    observedSkillIds: [...snapshot.injectedSkills].sort(),
    unrecognizedSkillObserved: snapshot.unrecognizedSkillObserved,
  };
}

function resultWithOptionalDiagnostic(
  status: ScenarioStatus,
  observedSkillIds: readonly string[],
  unrecognizedSkillObserved: boolean,
  diagnostic: ScenarioDiagnostic | undefined,
): BaseScenarioResult {
  const result: {
    status: ScenarioStatus;
    observedSkillIds: readonly string[];
    unrecognizedSkillObserved: boolean;
    diagnostic?: ScenarioDiagnostic;
  } = {
    status,
    observedSkillIds,
    unrecognizedSkillObserved,
  };
  if (diagnostic) {
    result.diagnostic = diagnostic;
  }
  return result;
}

export function buildScenarioResult(
  scenarioId: "direct",
  observation: ScenarioObservation,
): DirectScenarioResult;
export function buildScenarioResult(
  scenarioId: "nested",
  observation: ScenarioObservation,
): NestedScenarioResult;
export function buildScenarioResult(
  scenarioId: "subagent",
  observation: ScenarioObservation,
): SubagentScenarioResult;
export function buildScenarioResult(
  scenarioId: "direct" | "nested" | "subagent",
  observation: ScenarioObservation,
): DirectScenarioResult | NestedScenarioResult | SubagentScenarioResult {
  const normalized = normalizeObservation(scenarioId, observation);
  let status: ScenarioStatus;
  let diagnostic = observation.diagnostic;

  if (diagnostic === "multi-agent-unavailable") {
    status = "unsupported";
  } else if (
    diagnostic === "process-start-failed" ||
    diagnostic === "process-timeout" ||
    diagnostic === "process-exit-nonzero"
  ) {
    status = scenarioId === "subagent" ? "unsupported" : "failed";
  } else if (scenarioId === "direct") {
    status = normalized.observedSkillIds.includes(FIXTURE_SKILL_IDS.direct)
      ? "supported"
      : "failed";
    diagnostic ??=
      status === "failed" ? "direct-label-not-observed" : undefined;
  } else if (scenarioId === "nested") {
    const bothObserved = [
      FIXTURE_SKILL_IDS.nestedParent,
      FIXTURE_SKILL_IDS.nestedChild,
    ].every((skill) => normalized.observedSkillIds.includes(skill));
    status = bothObserved ? "supported" : "inconclusive";
    diagnostic ??=
      status === "inconclusive" ? "nested-label-not-observed" : undefined;
  } else {
    status = normalized.observedSkillIds.includes(
      FIXTURE_SKILL_IDS.subagentChild,
    )
      ? "supported"
      : "inconclusive";
    diagnostic ??=
      status === "inconclusive" ? "subagent-label-not-observed" : undefined;
  }

  const base = resultWithOptionalDiagnostic(
    status,
    normalized.observedSkillIds,
    normalized.unrecognizedSkillObserved,
    diagnostic,
  );
  if (scenarioId === "nested") {
    return { ...base, runtimeEdgeClaimed: false };
  }
  if (scenarioId === "subagent") {
    return { ...base, agentAttributionClaimed: false };
  }
  return base;
}

function buildRepeatedRunResult(
  observation: ScenarioObservation,
): RepeatedRunResult {
  const normalized = normalizeObservation("repeated", observation);
  let diagnostic = observation.diagnostic;
  const processFailed =
    diagnostic === "process-start-failed" ||
    diagnostic === "process-timeout" ||
    diagnostic === "process-exit-nonzero";
  const status =
    !processFailed &&
    normalized.observedSkillIds.includes(FIXTURE_SKILL_IDS.direct)
      ? "supported"
      : "failed";
  diagnostic ??=
    status === "failed" ? "repeated-label-not-observed" : undefined;
  return {
    ...resultWithOptionalDiagnostic(
      status,
      normalized.observedSkillIds,
      normalized.unrecognizedSkillObserved,
      diagnostic,
    ),
    status,
  };
}

export function buildRepeatedScenarioResult(
  observations: readonly [ScenarioObservation, ScenarioObservation],
): RepeatedScenarioResult {
  const runs = observations.map(buildRepeatedRunResult) as [
    RepeatedRunResult,
    RepeatedRunResult,
  ];
  return {
    status: runs.every((run) => run.status === "supported")
      ? "supported"
      : "failed",
    runs,
  };
}

export function buildIntegrationReport(options: {
  readonly codexVersion: string;
  readonly codexAnalyticsExplicitlyAllowed: true;
  readonly observations: IntegrationObservations;
}): IntegrationReport {
  if (options.codexAnalyticsExplicitlyAllowed !== true) {
    throw new Error(CODEX_ANALYTICS_CONSENT_MESSAGE);
  }
  return {
    schemaVersion: 1,
    provider: "codex",
    codexVersion: options.codexVersion,
    exportedMetric: "codex.skill.injected",
    codexAnalyticsExplicitlyAllowed: true,
    collectorSemantics: "presence",
    observationScope: "collector-lifetime",
    scenarios: {
      direct: buildScenarioResult("direct", options.observations.direct),
      repeated: buildRepeatedScenarioResult(options.observations.repeated),
      nested: buildScenarioResult("nested", options.observations.nested),
      subagent: buildScenarioResult("subagent", options.observations.subagent),
    },
    limitations: {
      skillExecutionClaimed: false,
      orderingClaimed: false,
      sessionAttributionClaimed: false,
      nestingEdgeClaimed: false,
      agentAttributionClaimed: false,
      instructionComplianceClaimed: false,
      taskSuccessClaimed: false,
    },
  };
}

function observedList(observedSkillIds: readonly string[]): string {
  return observedSkillIds.length > 0 ? observedSkillIds.join(", ") : "(none)";
}

function diagnosticLine(result: BaseScenarioResult): string[] {
  return result.diagnostic ? [`  diagnostic: ${result.diagnostic}`] : [];
}

export function formatConsoleSummary(report: IntegrationReport): string {
  const nestedResult =
    report.scenarios.nested.status === "supported"
      ? "both labels observed; no runtime edge implied"
      : `${report.scenarios.nested.status}; no runtime edge implied`;
  const subagentResult =
    report.scenarios.subagent.status === "supported"
      ? "label observed; agent attribution unavailable"
      : `${report.scenarios.subagent.status}; agent attribution unavailable`;

  return [
    `Codex version: ${report.codexVersion}`,
    "Collector semantics: presence",
    "Codex analytics explicitly allowed: true",
    "",
    "direct:",
    `  observed: ${observedList(report.scenarios.direct.observedSkillIds)}`,
    `  result: ${report.scenarios.direct.status}`,
    ...diagnosticLine(report.scenarios.direct),
    "",
    "repeated:",
    ...report.scenarios.repeated.runs.flatMap((run, index) => [
      `  run ${index + 1}:`,
      `    observed: ${observedList(run.observedSkillIds)}`,
      `    result: ${run.status}`,
      ...(run.diagnostic ? [`    diagnostic: ${run.diagnostic}`] : []),
    ]),
    `  result: ${report.scenarios.repeated.status}`,
    "",
    "nested:",
    `  observed: ${observedList(report.scenarios.nested.observedSkillIds)}`,
    `  result: ${nestedResult}`,
    ...diagnosticLine(report.scenarios.nested),
    "",
    "subagent:",
    `  observed: ${observedList(report.scenarios.subagent.observedSkillIds)}`,
    `  result: ${subagentResult}`,
    ...diagnosticLine(report.scenarios.subagent),
  ].join("\n");
}

function formatObservationDiagnostics(
  label: string,
  observation: ScenarioObservation,
): string[] {
  if (!observation.diagnostics) {
    return [`${label}: unavailable`];
  }
  return [
    `${label}: ${JSON.stringify(observation.diagnostics)}`,
    `${label} classification: ${classifyPipelineDiagnostics(observation.diagnostics)}`,
  ];
}

export function formatDiagnosticsSummary(
  observations: IntegrationObservations,
): string {
  return [
    "OTLP metrics pipeline diagnostics (not public Skill evidence):",
    ...formatObservationDiagnostics("direct", observations.direct),
    ...observations.repeated.flatMap((observation, index) =>
      formatObservationDiagnostics(`repeated run ${index + 1}`, observation),
    ),
    ...formatObservationDiagnostics("nested", observations.nested),
    ...formatObservationDiagnostics("subagent", observations.subagent),
  ].join("\n");
}

export function formatDirectBaselineSummary(options: {
  readonly codexVersion: string;
  readonly observation: ScenarioObservation;
}): string {
  const result = buildScenarioResult("direct", options.observation);
  return [
    `Codex version: ${options.codexVersion}`,
    "Command category: direct single-Skill baseline",
    "Codex analytics explicitly allowed: true",
    "Collector semantics: presence",
    `Observed Skill IDs: ${observedList(result.observedSkillIds)}`,
    `Result: ${result.status}`,
    ...diagnosticLine(result),
    ...formatObservationDiagnostics(
      "diagnostics snapshot",
      options.observation,
    ),
    "Limitations: no execution, count, ordering, session, nesting-edge, agent-attribution, instruction-compliance, or task-success claim is made.",
  ].join("\n");
}

export function reportRequiresFailure(report: IntegrationReport): boolean {
  return (
    report.scenarios.direct.status === "failed" ||
    report.scenarios.repeated.status === "failed" ||
    report.scenarios.nested.status === "failed"
  );
}
