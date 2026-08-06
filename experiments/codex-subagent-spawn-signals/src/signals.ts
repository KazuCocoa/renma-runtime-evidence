export const EXPERIMENT_ID = "codex-subagent-spawn-signals";
export const TARGET_SPAWN_METRIC_NAME = "codex.multi_agent.spawn";

export const SCENARIO_IDS = [
  "custom-agents-dormant",
  "single-custom-agent",
  "nested-custom-agent",
  "parallel-custom-agents",
] as const;

export const SYNTHETIC_AGENT_ROLES = [
  "renma_spawn_signal_dormant_20260806",
  "renma_spawn_signal_worker_20260806",
  "renma_spawn_signal_nested_worker_20260806",
  "renma_spawn_signal_alpha_20260806",
  "renma_spawn_signal_beta_20260806",
] as const;

export const SYNTHETIC_SKILL_NAMES = [
  "renma-spawn-signal-orchestrator-dormant-20260806",
  "renma-spawn-signal-orchestrator-single-20260806",
  "renma-spawn-signal-orchestrator-nested-20260806",
  "renma-spawn-signal-orchestrator-parallel-20260806",
  "renma-spawn-signal-nested-root-20260806",
  "renma-spawn-signal-nested-leaf-20260806",
] as const;

export const SPAWN_ROLE_CLASSIFICATIONS = [
  "allowlisted-role",
  "non-allowlisted-role",
  "missing-role",
  "non-string-role",
  "duplicate-role-attribute",
] as const;

export type ScenarioId = (typeof SCENARIO_IDS)[number];
export type SyntheticAgentRole = (typeof SYNTHETIC_AGENT_ROLES)[number];
export type SyntheticSkillName = (typeof SYNTHETIC_SKILL_NAMES)[number];
export type SpawnRoleClassification =
  (typeof SPAWN_ROLE_CLASSIFICATIONS)[number];

export interface SpawnSignalObservation {
  spawnMetricObserved: boolean;
  spawnDataPointObserved: boolean;
  spawnRoleClassifications: SpawnRoleClassification[];
  spawnedRoles: SyntheticAgentRole[];
}

type UnknownRecord = Record<string, unknown>;

const syntheticAgentRoles: ReadonlySet<string> = new Set(SYNTHETIC_AGENT_ROLES);
const spawnRoleClassifications: ReadonlySet<string> = new Set(
  SPAWN_ROLE_CLASSIFICATIONS,
);

export function emptySpawnSignalObservation(): SpawnSignalObservation {
  return {
    spawnMetricObserved: false,
    spawnDataPointObserved: false,
    spawnRoleClassifications: [],
    spawnedRoles: [],
  };
}

export function isSyntheticAgentRole(
  value: unknown,
): value is SyntheticAgentRole {
  return typeof value === "string" && syntheticAgentRoles.has(value);
}

export function isSpawnRoleClassification(
  value: unknown,
): value is SpawnRoleClassification {
  return typeof value === "string" && spawnRoleClassifications.has(value);
}

function asRecord(value: unknown): UnknownRecord | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as UnknownRecord;
}

function requireRecord(value: unknown): UnknownRecord {
  const record = asRecord(value);
  if (!record) {
    throw new Error("Malformed OTLP JSON payload");
  }
  return record;
}

function requireArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error("Malformed OTLP JSON payload");
  }
  return value;
}

function classifyRoleAttribute(dataPoint: UnknownRecord): {
  classification: SpawnRoleClassification;
  role?: SyntheticAgentRole;
} {
  const attributes =
    dataPoint.attributes === undefined
      ? []
      : requireArray(dataPoint.attributes);
  const roleAttributes: UnknownRecord[] = [];

  for (const candidate of attributes) {
    const attribute = asRecord(candidate);
    if (attribute?.key === "role") {
      roleAttributes.push(attribute);
    }
  }

  if (roleAttributes.length === 0) {
    return { classification: "missing-role" };
  }
  if (roleAttributes.length !== 1) {
    return { classification: "duplicate-role-attribute" };
  }

  const roleAttribute = roleAttributes[0];
  if (!roleAttribute) {
    throw new Error("Role classification invariant failed");
  }
  const value = asRecord(roleAttribute.value);
  const role = value?.stringValue;
  if (typeof role !== "string") {
    return { classification: "non-string-role" };
  }
  if (!isSyntheticAgentRole(role)) {
    return { classification: "non-allowlisted-role" };
  }
  return { classification: "allowlisted-role", role };
}

export function normalizeSpawnSignalObservation(options: {
  spawnMetricObserved: boolean;
  spawnDataPointObserved: boolean;
  spawnRoleClassifications: readonly SpawnRoleClassification[];
  spawnedRoles: readonly SyntheticAgentRole[];
}): SpawnSignalObservation {
  const spawnMetricObserved = options.spawnMetricObserved === true;
  const spawnDataPointObserved =
    spawnMetricObserved && options.spawnDataPointObserved === true;
  const classifications = spawnDataPointObserved
    ? [...new Set(options.spawnRoleClassifications)].filter(
        isSpawnRoleClassification,
      )
    : [];
  const roles = classifications.includes("allowlisted-role")
    ? [...new Set(options.spawnedRoles)].filter(isSyntheticAgentRole)
    : [];

  return {
    spawnMetricObserved,
    spawnDataPointObserved,
    spawnRoleClassifications: classifications.sort(),
    spawnedRoles: roles.sort(),
  };
}

export function mergeSpawnSignalObservations(
  observations: readonly SpawnSignalObservation[],
): SpawnSignalObservation {
  return normalizeSpawnSignalObservation({
    spawnMetricObserved: observations.some(
      (observation) => observation.spawnMetricObserved,
    ),
    spawnDataPointObserved: observations.some(
      (observation) => observation.spawnDataPointObserved,
    ),
    spawnRoleClassifications: observations.flatMap(
      (observation) => observation.spawnRoleClassifications,
    ),
    spawnedRoles: observations.flatMap(
      (observation) => observation.spawnedRoles,
    ),
  });
}

export function extractSpawnSignalObservation(
  payload: unknown,
): SpawnSignalObservation {
  const root = requireRecord(payload);
  const classifications: SpawnRoleClassification[] = [];
  const roles: SyntheticAgentRole[] = [];
  let spawnMetricObserved = false;
  let spawnDataPointObserved = false;

  for (const resourceCandidate of requireArray(root.resourceMetrics)) {
    const resourceMetric = requireRecord(resourceCandidate);
    for (const scopeCandidate of requireArray(resourceMetric.scopeMetrics)) {
      const scopeMetric = requireRecord(scopeCandidate);
      for (const metricCandidate of requireArray(scopeMetric.metrics)) {
        const metric = requireRecord(metricCandidate);
        if (metric.name !== TARGET_SPAWN_METRIC_NAME) {
          continue;
        }

        spawnMetricObserved = true;
        if (metric.sum === undefined) {
          continue;
        }
        const sum = requireRecord(metric.sum);
        if (sum.dataPoints === undefined) {
          continue;
        }

        for (const pointCandidate of requireArray(sum.dataPoints)) {
          spawnDataPointObserved = true;
          const result = classifyRoleAttribute(requireRecord(pointCandidate));
          classifications.push(result.classification);
          if (result.role) {
            roles.push(result.role);
          }
        }
      }
    }
  }

  return normalizeSpawnSignalObservation({
    spawnMetricObserved,
    spawnDataPointObserved,
    spawnRoleClassifications: classifications,
    spawnedRoles: roles,
  });
}
