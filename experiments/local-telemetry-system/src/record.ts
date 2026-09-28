import { createHash } from "node:crypto";
import {
  freezeManifest,
  resolveCandidates,
  DEPLOYMENTS,
  type Deployment,
  type Entry,
} from "./provenance.js";
const object = (v: unknown): Record<string, unknown> | undefined =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
const utc = (v: unknown): v is string =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) &&
  Number.isFinite(Date.parse(v));
const nano = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[1-9][0-9]{0,19}$/.test(v) &&
  BigInt(v) <= (1n << 64n) - 1n;
export const PRODUCERS = [
  "native-current",
  "native-previous",
  "docker-current",
  "delivery-fixture",
] as const;
export const EVIDENCE = [
  "real-cli",
  "synthetic-delivery",
  "saved-replay",
] as const;
export interface Observation {
  schemaVersion: "renma.local-observation.v1";
  producer: (typeof PRODUCERS)[number];
  receiverEpoch: "first" | "restarted";
  producerEpoch: "run-1" | "run-2" | "run-3" | "run-4" | "run-5";
  monotonic: true;
  seriesIdentity: "not-retained";
  evidenceClass: (typeof EVIDENCE)[number];
  observedAt: string;
  skill: "renma-usage-alpha" | "renma-usage-beta";
  providerLabel: string;
  value: number;
  aggregation: "delta";
  intervalStart: string;
  intervalEnd: string;
  deployments: Deployment[];
  manifest: readonly Entry[];
}
/** Strict reconstruction precedes hashing, transmission and persistence. */
export function observation(value: unknown): Observation {
  const r = object(value);
  if (
    !r ||
    r.schemaVersion !== "renma.local-observation.v1" ||
    typeof r.producerEpoch !== "string" ||
    !["run-1", "run-2", "run-3", "run-4", "run-5"].includes(
      String(r.producerEpoch),
    ) ||
    r.monotonic !== true ||
    r.seriesIdentity !== "not-retained" ||
    !PRODUCERS.includes(r.producer as Observation["producer"]) ||
    !EVIDENCE.includes(r.evidenceClass as Observation["evidenceClass"]) ||
    typeof r.receiverEpoch !== "string" ||
    !["first", "restarted"].includes(String(r.receiverEpoch)) ||
    !utc(r.observedAt) ||
    typeof r.skill !== "string" ||
    typeof r.providerLabel !== "string" ||
    !["renma-usage-alpha", "renma-usage-beta"].includes(String(r.skill)) ||
    !Number.isSafeInteger(r.value) ||
    Number(r.value) < 0 ||
    Number(r.value) > 1000000 ||
    r.aggregation !== "delta" ||
    !nano(r.intervalStart) ||
    !nano(r.intervalEnd) ||
    BigInt(r.intervalStart) >= BigInt(r.intervalEnd) ||
    !Array.isArray(r.deployments) ||
    !Array.isArray(r.manifest)
  )
    throw new Error("Invalid observation");
  const providerLabel = String(r.providerLabel);
  if (
    ![
      `renma-usage-fixture_${r.skill}`,
      `renma-usage-fixture:${r.skill}`,
    ].includes(providerLabel)
  )
    throw new Error("Unknown provider label");
  if (
    !r.deployments.length ||
    r.deployments.length > 4 ||
    new Set(r.deployments).size !== r.deployments.length ||
    r.deployments.some((d) => !DEPLOYMENTS.includes(d))
  )
    throw new Error("Unknown deployment");
  const deployments = DEPLOYMENTS.filter((d) =>
    (r.deployments as unknown[]).includes(d),
  );
  const manifest = freezeManifest(r.manifest as Entry[]).filter(
    (row) => row.skill === r.skill && deployments.includes(row.deployment),
  );
  if (
    resolveCandidates(manifest, deployments, providerLabel).state === "unmapped"
  )
    throw new Error("Incomplete provenance");
  return {
    schemaVersion: "renma.local-observation.v1",
    producer: r.producer as Observation["producer"],
    receiverEpoch: r.receiverEpoch as Observation["receiverEpoch"],
    producerEpoch: r.producerEpoch as Observation["producerEpoch"],
    monotonic: true,
    seriesIdentity: "not-retained",
    evidenceClass: r.evidenceClass as Observation["evidenceClass"],
    observedAt: r.observedAt,
    skill: r.skill as Observation["skill"],
    providerLabel,
    value: Number(r.value),
    aggregation: "delta",
    intervalStart: r.intervalStart,
    intervalEnd: r.intervalEnd,
    deployments,
    manifest: Object.freeze(
      [...manifest].sort(
        (a, b) =>
          DEPLOYMENTS.indexOf(a.deployment) - DEPLOYMENTS.indexOf(b.deployment),
      ),
    ),
  };
}
export function observationId(input: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(observation(input)))
    .digest("hex");
}
export function encodeOtlp(inputs: readonly unknown[]) {
  if (!inputs.length || inputs.length > 16)
    throw new Error("Invalid batch size");
  return {
    resourceLogs: [
      {
        scopeLogs: [
          {
            scope: { name: "renma.local-telemetry", version: "1" },
            logRecords: inputs.map((input) => {
              const record = observation(input);
              return {
                observedTimeUnixNano: (
                  BigInt(Date.parse(record.observedAt)) * 1000000n
                ).toString(),
                attributes: [
                  {
                    key: "renma.observation",
                    value: { stringValue: JSON.stringify(record) },
                  },
                ],
              };
            }),
          },
        ],
      },
    ],
  };
}
export function decodeOtlp(input: unknown): Observation[] {
  const resources = object(input)?.resourceLogs;
  if (!Array.isArray(resources) || resources.length > 16)
    throw new Error("Invalid OTLP");
  const result: Observation[] = [];
  for (const resource of resources) {
    const scopes = object(resource)?.scopeLogs;
    if (!Array.isArray(scopes) || scopes.length > 16)
      throw new Error("Invalid scopes");
    for (const rawScope of scopes) {
      const scope = object(rawScope);
      if (object(scope?.scope)?.name !== "renma.local-telemetry") continue;
      const logs = scope?.logRecords;
      if (!Array.isArray(logs) || logs.length > 16)
        throw new Error("Invalid logs");
      for (const rawLog of logs) {
        const attrs = object(rawLog)?.attributes;
        if (!Array.isArray(attrs) || attrs.length > 64)
          throw new Error("Invalid attributes");
        const matches = attrs
          .map(object)
          .filter((a) => a?.key === "renma.observation");
        const text = object(matches[0]?.value)?.stringValue;
        if (
          matches.length !== 1 ||
          typeof text !== "string" ||
          text.length > 16384
        )
          throw new Error("Invalid record");
        result.push(observation(JSON.parse(text)));
        if (result.length > 16) throw new Error("Batch limit");
      }
    }
  }
  if (!result.length) throw new Error("No known observations");
  return result;
}
