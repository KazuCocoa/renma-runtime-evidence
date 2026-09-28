import { readFile } from "node:fs/promises";
import { analyzeTiming } from "./timing.js";
const reports = [];
for (const filename of [
  "20260928-alpha-first-same-thread.json",
  "20260928-beta-first-new-thread.json",
  "20260928-outage-recovery.json",
]) {
  const r = JSON.parse(
    await readFile(
      `experiments/codex-telemetry-coexistence/results/${filename}`,
      "utf8",
    ),
  );
  const epochs = [...(r.receiverEpochs ?? []), r.telemetry];
  reports.push({
    source: filename,
    epochs: epochs.map((e, index) => ({
      epoch: index,
      producers: e.producers.map(
        (p: {
          producer: string;
          samples: Parameters<typeof analyzeTiming>[0];
        }) => ({ producer: p.producer, timing: analyzeTiming(p.samples) }),
      ),
    })),
  });
}
process.stdout.write(
  JSON.stringify(
    {
      schemaVersion: "renma.receipt-time-analysis.v1",
      evidenceClass: "derived-from-saved-real-reports",
      reports,
    },
    null,
    2,
  ) + "\n",
);
