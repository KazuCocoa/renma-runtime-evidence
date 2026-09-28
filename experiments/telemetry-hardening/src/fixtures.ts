import { readFile } from "node:fs/promises";
import { observation } from "../../local-telemetry-system/src/record.js";
export async function fixture(ordinal: number) {
  if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > 1025)
    throw new Error("Fixture bound");
  const report = JSON.parse(
    await readFile(
      "experiments/local-telemetry-system/results/20260928-sync.json",
      "utf8",
    ),
  );
  return observation({
    schemaVersion: "renma.local-observation.v1",
    producer: "delivery-fixture",
    producerEpoch: "run-2",
    receiverEpoch: "first",
    evidenceClass: "synthetic-delivery",
    observedAt: new Date().toISOString(),
    skill: "renma-usage-alpha",
    providerLabel: "renma-usage-fixture_renma-usage-alpha",
    value: 1,
    aggregation: "delta",
    monotonic: true,
    seriesIdentity: "not-retained",
    intervalStart: String(1790600000000000000n + BigInt(ordinal) * 1000000000n),
    intervalEnd: String(1790600001000000000n + BigInt(ordinal) * 1000000000n),
    deployments: ["initial"],
    manifest: report.manifest,
  });
}
