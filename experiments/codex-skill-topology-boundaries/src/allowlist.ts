export const EXPERIMENT_ID = "codex-skill-topology-boundaries";
export const TARGET_SKILL_METRIC_NAME = "codex.skill.injected";
export const TARGET_SPAWN_METRIC_NAME = "codex.multi_agent.spawn";

export const PHASE_A_SCENARIO_IDS = [
  "nested-chain-depth-2",
  "nested-chain-depth-3",
  "nested-branch",
  "nested-diamond",
] as const;

export const PHASE_B_SCENARIO_IDS = [
  "subagent-config-dormant",
  "subagent-single-skill",
  "subagent-nested-chain",
  "subagent-parallel",
] as const;

export const SCENARIO_IDS = [
  ...PHASE_A_SCENARIO_IDS,
  ...PHASE_B_SCENARIO_IDS,
] as const;

export const SYNTHETIC_SKILL_NAMES = [
  "renma-topology-depth2-root-20260806",
  "renma-topology-depth2-level1-20260806",
  "renma-topology-depth2-level2-20260806",
  "renma-topology-depth3-root-20260806",
  "renma-topology-depth3-level1-20260806",
  "renma-topology-depth3-level2-20260806",
  "renma-topology-depth3-level3-20260806",
  "renma-topology-branch-root-20260806",
  "renma-topology-branch-a-20260806",
  "renma-topology-branch-b-20260806",
  "renma-topology-diamond-root-20260806",
  "renma-topology-diamond-branch-a-20260806",
  "renma-topology-diamond-branch-b-20260806",
  "renma-topology-diamond-shared-20260806",
  "renma-topology-orchestrator-dormant-20260806",
  "renma-topology-dormant-child-20260806",
  "renma-topology-orchestrator-single-20260806",
  "renma-topology-child-single-20260806",
  "renma-topology-orchestrator-chain-20260806",
  "renma-topology-orchestrator-parallel-20260806",
  "renma-topology-child-alpha-20260806",
  "renma-topology-child-beta-20260806",
] as const;

export const SYNTHETIC_AGENT_ROLES = [
  "renma_topology_dormant_20260806",
  "renma_topology_worker_20260806",
  "renma_topology_chain_worker_20260806",
  "renma_topology_alpha_20260806",
  "renma_topology_beta_20260806",
] as const;

export type ScenarioId = (typeof SCENARIO_IDS)[number];
export type SyntheticSkillName = (typeof SYNTHETIC_SKILL_NAMES)[number];
export type SyntheticAgentRole = (typeof SYNTHETIC_AGENT_ROLES)[number];

export interface AcceptedSkillSignal {
  kind: "skill";
  scenario: ScenarioId;
  skill: SyntheticSkillName;
  status: "ok";
  receivedAt: string;
}

export interface AcceptedSpawnSignal {
  kind: "spawn";
  scenario: ScenarioId;
  role: SyntheticAgentRole;
  receivedAt: string;
}

export type AcceptedSignal = AcceptedSkillSignal | AcceptedSpawnSignal;

export interface RuntimePresenceSet {
  injectedSkills: SyntheticSkillName[];
  spawnedRoles: SyntheticAgentRole[];
  verifiedSkillStatus?: "ok";
  collectorReceipt?: {
    firstAcceptedAt: string;
  };
}

interface ExtractionContext {
  scenario: unknown;
  receivedAt: string;
}

type UnknownRecord = Record<string, unknown>;

const scenarioIds: ReadonlySet<string> = new Set(SCENARIO_IDS);
const syntheticSkillNames: ReadonlySet<string> = new Set(SYNTHETIC_SKILL_NAMES);
const syntheticAgentRoles: ReadonlySet<string> = new Set(SYNTHETIC_AGENT_ROLES);

export function isScenarioId(value: unknown): value is ScenarioId {
  return typeof value === "string" && scenarioIds.has(value);
}

export function isSyntheticSkillName(
  value: unknown,
): value is SyntheticSkillName {
  return typeof value === "string" && syntheticSkillNames.has(value);
}

export function isSyntheticAgentRole(
  value: unknown,
): value is SyntheticAgentRole {
  return typeof value === "string" && syntheticAgentRoles.has(value);
}

function asRecord(value: unknown): UnknownRecord | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  return value as UnknownRecord;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readSingleStringAttribute(
  attributes: unknown,
  allowedKey: "skill" | "status" | "role",
): string | undefined {
  const values: string[] = [];

  for (const candidate of asArray(attributes)) {
    const attribute = asRecord(candidate);
    if (attribute?.key !== allowedKey) {
      continue;
    }

    const value = asRecord(attribute.value);
    if (typeof value?.stringValue !== "string") {
      return undefined;
    }
    values.push(value.stringValue);
  }

  return values.length === 1 ? values[0] : undefined;
}

function readDataPoints(metric: UnknownRecord): unknown[] {
  const sum = asRecord(metric.sum);
  return sum ? asArray(sum.dataPoints) : [];
}

export function extractAllowlistedSignals(
  payload: unknown,
  context: ExtractionContext,
): AcceptedSignal[] {
  if (!isScenarioId(context.scenario)) {
    return [];
  }

  const root = asRecord(payload);
  const signals: AcceptedSignal[] = [];

  for (const resourceCandidate of asArray(root?.resourceMetrics)) {
    const resourceMetric = asRecord(resourceCandidate);
    for (const scopeCandidate of asArray(resourceMetric?.scopeMetrics)) {
      const scopeMetric = asRecord(scopeCandidate);
      for (const metricCandidate of asArray(scopeMetric?.metrics)) {
        const metric = asRecord(metricCandidate);

        if (metric?.name === TARGET_SKILL_METRIC_NAME) {
          for (const pointCandidate of readDataPoints(metric)) {
            const point = asRecord(pointCandidate);
            const skill = readSingleStringAttribute(point?.attributes, "skill");
            const status = readSingleStringAttribute(
              point?.attributes,
              "status",
            );

            if (!isSyntheticSkillName(skill) || status !== "ok") {
              continue;
            }

            signals.push({
              kind: "skill",
              scenario: context.scenario,
              skill,
              status,
              receivedAt: context.receivedAt,
            });
          }
        } else if (metric?.name === TARGET_SPAWN_METRIC_NAME) {
          for (const pointCandidate of readDataPoints(metric)) {
            const point = asRecord(pointCandidate);
            const role = readSingleStringAttribute(point?.attributes, "role");

            if (!isSyntheticAgentRole(role)) {
              continue;
            }

            signals.push({
              kind: "spawn",
              scenario: context.scenario,
              role,
              receivedAt: context.receivedAt,
            });
          }
        }
      }
    }
  }

  return signals;
}

export function normalizeRuntimePresence(
  signals: readonly AcceptedSignal[],
): RuntimePresenceSet {
  const injectedSkills = [
    ...new Set(
      signals.flatMap((signal) =>
        signal.kind === "skill" ? [signal.skill] : [],
      ),
    ),
  ].sort();
  const spawnedRoles = [
    ...new Set(
      signals.flatMap((signal) =>
        signal.kind === "spawn" ? [signal.role] : [],
      ),
    ),
  ].sort();

  if (injectedSkills.length === 0 && spawnedRoles.length === 0) {
    return { injectedSkills, spawnedRoles };
  }

  const firstAcceptedAt = signals.map((signal) => signal.receivedAt).sort()[0];
  if (!firstAcceptedAt) {
    throw new Error("Accepted signals must have collector receipt metadata");
  }

  return {
    injectedSkills,
    spawnedRoles,
    ...(injectedSkills.length > 0
      ? { verifiedSkillStatus: "ok" as const }
      : {}),
    collectorReceipt: { firstAcceptedAt },
  };
}
