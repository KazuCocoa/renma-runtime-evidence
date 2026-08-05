export const EXPERIMENT_ID = "codex-skill-activation-paths";
export const TARGET_METRIC_NAME = "codex.skill.injected";

export const SCENARIO_IDS = [
  "discovered-only",
  "explicit-single",
  "explicit-multiple",
  "router-to-target",
  "implicit-match",
] as const;

export const SYNTHETIC_SKILL_NAMES = [
  "renma-activation-dormant-20260805",
  "renma-activation-explicit-alpha-20260805",
  "renma-activation-explicit-beta-20260805",
  "renma-activation-explicit-single-20260805",
  "renma-activation-implicit-20260805",
  "renma-activation-router-20260805",
  "renma-activation-router-target-20260805",
] as const;

export type ScenarioId = (typeof SCENARIO_IDS)[number];
export type SyntheticSkillName = (typeof SYNTHETIC_SKILL_NAMES)[number];

export interface AcceptedSkillSignal {
  scenario: ScenarioId;
  skill: SyntheticSkillName;
  status: "ok";
  receivedAt: string;
}

export interface SkillPresenceSet {
  injectedSkills: SyntheticSkillName[];
  verifiedStatus?: "ok";
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

export function isScenarioId(value: unknown): value is ScenarioId {
  return typeof value === "string" && scenarioIds.has(value);
}

function isSyntheticSkillName(value: unknown): value is SyntheticSkillName {
  return typeof value === "string" && syntheticSkillNames.has(value);
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
  allowedKey: "skill" | "status",
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
): AcceptedSkillSignal[] {
  if (!isScenarioId(context.scenario)) {
    return [];
  }

  const root = asRecord(payload);
  const signals: AcceptedSkillSignal[] = [];

  for (const resourceCandidate of asArray(root?.resourceMetrics)) {
    const resourceMetric = asRecord(resourceCandidate);
    for (const scopeCandidate of asArray(resourceMetric?.scopeMetrics)) {
      const scopeMetric = asRecord(scopeCandidate);
      for (const metricCandidate of asArray(scopeMetric?.metrics)) {
        const metric = asRecord(metricCandidate);
        if (metric?.name !== TARGET_METRIC_NAME) {
          continue;
        }

        for (const pointCandidate of readDataPoints(metric)) {
          const point = asRecord(pointCandidate);
          const skill = readSingleStringAttribute(point?.attributes, "skill");
          const status = readSingleStringAttribute(point?.attributes, "status");

          if (!isSyntheticSkillName(skill) || status !== "ok") {
            continue;
          }

          signals.push({
            scenario: context.scenario,
            skill,
            status,
            receivedAt: context.receivedAt,
          });
        }
      }
    }
  }

  return signals;
}

export function normalizeSkillPresence(
  signals: readonly AcceptedSkillSignal[],
): SkillPresenceSet {
  const injectedSkills = [
    ...new Set(signals.map((signal) => signal.skill)),
  ].sort();

  if (injectedSkills.length === 0) {
    return { injectedSkills };
  }

  const firstAcceptedAt = signals.map((signal) => signal.receivedAt).sort()[0];

  if (!firstAcceptedAt) {
    throw new Error("Accepted signals must have collector receipt metadata");
  }

  return {
    injectedSkills,
    verifiedStatus: "ok",
    collectorReceipt: { firstAcceptedAt },
  };
}
