import { readFile, writeFile } from "node:fs/promises";
import {
  summarize,
  type Sample,
} from "../../codex-plugin-usage/src/collector.js";
type Row = {
  layout: string;
  turns: {
    scenario: string;
    status: string;
    hooks: { event: string; fullFixtureReturned: string[] }[];
  }[];
  counterSamples: (Omit<Sample, "skill"> & { candidateAssets: string[] })[];
};
const input = process.argv[2],
  output = process.argv[3];
if (!input || !output) throw new Error("Input/output required");
const report = JSON.parse(await readFile(input, "utf8")) as {
  turnsAttempted: number;
  results: Row[];
};
const result = {
  evidenceClass: "derived-from-saved-allowlisted-runtime-observations",
  turnsAttempted: report.turnsAttempted,
  results: report.results.map((r) => ({
    layout: r.layout,
    turns: r.turns.map((t) => ({
      scenario: t.scenario,
      status: t.status,
      returnedSkillObservations: t.hooks
        .filter((h) => h.event === "PostToolUse")
        .flatMap((h) => h.fullFixtureReturned),
    })),
    metrics: [...new Set(r.counterSamples.map((s) => s.providerSkill))].map(
      (label) => {
        const rows = r.counterSamples.filter((s) => s.providerSkill === label);
        // The normalizer's fixture alias only selects a group; it is not an asset identity.
        const s = summarize(
          rows.map((row) => ({ ...row, skill: "renma-usage-alpha" as const })),
        )[0]!;
        return {
          providerLabel: label,
          candidateAssets: rows[0]!.candidateAssets,
          receivedCounterTotal: s.providerCounterTotal,
          receivedSamples: s.receivedSamples,
          intervalGaps: s.deltaIntervalGapsObserved,
          coverage: s.coverage,
        };
      },
    ),
  })),
};
await writeFile(output, JSON.stringify(result, null, 2) + "\n");
