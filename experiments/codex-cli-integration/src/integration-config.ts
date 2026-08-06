import { isAbsolute } from "node:path";

import type { CodexSkillPresenceSnapshot } from "../../../src/index.js";

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
  readonly outputPath?: string;
}

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
}

interface BaseScenarioResult {
  readonly status: ScenarioStatus;
  readonly observedSkillIds: readonly string[];
  readonly unrecognizedSkillObserved: boolean;
  readonly diagnostic?: ScenarioDiagnostic;
}

export interface DirectScenarioResult extends BaseScenarioResult {}

export interface RepeatedScenarioResult extends BaseScenarioResult {}

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
  readonly diagnostic?: ScenarioDiagnostic;
}

export function parseRunnerArguments(args: readonly string[]): RunnerArguments {
  if (args.length === 0) {
    return {};
  }
  if (args.length !== 2 || args[0] !== "--output" || !args[1]) {
    throw new Error(
      "Usage: npm run test:integration:codex -- [--output <new-file>]",
    );
  }
  return { outputPath: args[1] };
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
    "read-only",
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
  scenarioId: "repeated",
  observation: ScenarioObservation,
): RepeatedScenarioResult;
export function buildScenarioResult(
  scenarioId: "nested",
  observation: ScenarioObservation,
): NestedScenarioResult;
export function buildScenarioResult(
  scenarioId: "subagent",
  observation: ScenarioObservation,
): SubagentScenarioResult;
export function buildScenarioResult(
  scenarioId: ScenarioId,
  observation: ScenarioObservation,
):
  | DirectScenarioResult
  | RepeatedScenarioResult
  | NestedScenarioResult
  | SubagentScenarioResult {
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
  } else if (scenarioId === "repeated") {
    status = normalized.observedSkillIds.includes(FIXTURE_SKILL_IDS.direct)
      ? "supported"
      : "failed";
    diagnostic ??=
      status === "failed" ? "repeated-label-not-observed" : undefined;
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

export function buildIntegrationReport(options: {
  readonly codexVersion: string;
  readonly observations: Readonly<Record<ScenarioId, ScenarioObservation>>;
}): IntegrationReport {
  return {
    schemaVersion: 1,
    provider: "codex",
    codexVersion: options.codexVersion,
    exportedMetric: "codex.skill.injected",
    collectorSemantics: "presence",
    observationScope: "collector-lifetime",
    scenarios: {
      direct: buildScenarioResult("direct", options.observations.direct),
      repeated: buildScenarioResult("repeated", options.observations.repeated),
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
    "",
    "direct:",
    `  observed: ${observedList(report.scenarios.direct.observedSkillIds)}`,
    `  result: ${report.scenarios.direct.status}`,
    ...diagnosticLine(report.scenarios.direct),
    "",
    "repeated:",
    `  observed: ${observedList(report.scenarios.repeated.observedSkillIds)}`,
    `  result: ${report.scenarios.repeated.status === "supported" ? "presence confirmed" : report.scenarios.repeated.status}`,
    ...diagnosticLine(report.scenarios.repeated),
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

export function reportRequiresFailure(report: IntegrationReport): boolean {
  return (
    report.scenarios.direct.status === "failed" ||
    report.scenarios.repeated.status === "failed" ||
    report.scenarios.nested.status === "failed"
  );
}
