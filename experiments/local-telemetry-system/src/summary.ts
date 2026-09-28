import { observation, observationId, type Observation } from "./record.js";
import { resolveCandidates } from "./provenance.js";

/** Conservative count: only disjoint delta intervals within each known producer epoch. */
export function summarizeObservations(inputs: readonly unknown[]) {
  const unique = new Map(
    inputs.map((input) => {
      const row = observation(input);
      return [observationId(row), row] as const;
    }),
  );
  return (["renma-usage-alpha", "renma-usage-beta"] as const).map((skill) => {
    const rows = [...unique.values()].filter((row) => row.skill === skill);
    const groups = new Map<string, Observation[]>();
    for (const row of rows) {
      const key = `${row.evidenceClass}:${row.producer}:${row.producerEpoch}`;
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    }
    let overlap = false,
      gaps = false;
    for (const group of groups.values()) {
      group.sort((a, b) =>
        BigInt(a.intervalStart) < BigInt(b.intervalStart) ? -1 : 1,
      );
      for (let i = 1; i < group.length; i++) {
        if (BigInt(group[i]!.intervalStart) < BigInt(group[i - 1]!.intervalEnd))
          overlap = true;
        if (BigInt(group[i]!.intervalStart) > BigInt(group[i - 1]!.intervalEnd))
          gaps = true;
      }
    }
    const sum = rows.reduce((total, row) => total + row.value, 0);
    const total =
      !rows.length || overlap || !Number.isSafeInteger(sum) ? null : sum;
    const times = rows.map((row) => row.observedAt).sort();
    const increases = rows
      .filter((row) => row.value > 0)
      .map((row) => row.observedAt)
      .sort();
    const resolved = rows.map((row) =>
      resolveCandidates(row.manifest, row.deployments, row.providerLabel),
    );
    const precedence = [
      "modified-deployment",
      "ambiguous-content",
      "equivalent-content",
      "unique-deployment",
    ];
    const resolution =
      precedence.find((state) => resolved.some((row) => row.state === state)) ??
      "unobserved";
    const commits = [
      ...new Set(
        resolved.flatMap((row) =>
          row.candidates.map((candidate) => candidate.sourceCommit),
        ),
      ),
    ];
    return {
      skill,
      assetId:
        skill === "renma-usage-alpha"
          ? "skill.fixture-alpha"
          : "skill.fixture-beta",
      samples: rows.length,
      total,
      countState: !rows.length
        ? "no-sample"
        : overlap
          ? "ambiguous-overlap"
          : !Number.isSafeInteger(sum)
            ? "overflow"
            : "received-disjoint-deltas",
      coverage: "received-only-completeness-unknown",
      gaps,
      firstReceivedAt: times[0] ?? null,
      lastReceivedAt: times.at(-1) ?? null,
      lastIncreaseAt: increases.at(-1) ?? null,
      resolution,
      sourceCommits: commits,
    };
  });
}
