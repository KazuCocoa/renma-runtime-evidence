export const TARGET_METRIC_NAME = "codex.skill.injected";
export const SYNTHETIC_SKILL_NAME = "renma-runtime-evidence-canary-20260804";

export interface SkillInjectionObservation {
  schemaVersion: 1;
  provider: "codex";
  observationType: "skill-injected";
  skill: typeof SYNTHETIC_SKILL_NAME;
  status: string;
  codexVersion: string;
  observedAt: string;
  experimentRunId: string;
}

interface ObservationContext {
  codexVersion: string;
  observedAt: string;
  experimentRunId: string;
}

type UnknownRecord = Record<string, unknown>;

const SAFE_STATUS = /^[A-Za-z0-9._-]{1,64}$/;

function asRecord(value: unknown): UnknownRecord | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  return value as UnknownRecord;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readStringAttribute(
  attributes: unknown,
  allowedKey: "skill" | "status",
): string | undefined {
  for (const candidate of asArray(attributes)) {
    const attribute = asRecord(candidate);
    if (attribute?.key !== allowedKey) {
      continue;
    }

    const value = asRecord(attribute.value);
    return typeof value?.stringValue === "string"
      ? value.stringValue
      : undefined;
  }

  return undefined;
}

function readDataPoints(metric: UnknownRecord): unknown[] {
  const sum = asRecord(metric.sum);
  if (sum) {
    return asArray(sum.dataPoints);
  }

  return [];
}

export function extractAllowlistedObservations(
  payload: unknown,
  context: ObservationContext,
): SkillInjectionObservation[] {
  const root = asRecord(payload);
  const observations: SkillInjectionObservation[] = [];

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
          const skill = readStringAttribute(point?.attributes, "skill");
          const status = readStringAttribute(point?.attributes, "status");

          if (
            skill !== SYNTHETIC_SKILL_NAME ||
            status === undefined ||
            !SAFE_STATUS.test(status)
          ) {
            continue;
          }

          observations.push({
            schemaVersion: 1,
            provider: "codex",
            observationType: "skill-injected",
            skill: SYNTHETIC_SKILL_NAME,
            status,
            codexVersion: context.codexVersion,
            observedAt: context.observedAt,
            experimentRunId: context.experimentRunId,
          });
        }
      }
    }
  }

  return observations;
}
