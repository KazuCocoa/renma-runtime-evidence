import { readFile } from "node:fs/promises";
import {
  observation,
  type Observation,
} from "../../local-telemetry-system/src/record.js";
import { summarizeObservations } from "../../local-telemetry-system/src/summary.js";
import { fixture } from "./fixtures.js";
export async function aggregationCases() {
  const first = await fixture(1),
    third = await fixture(3);
  const stamp = "2026-09-28T12:00:00.000Z";
  const a = observation({ ...first, observedAt: stamp });
  const c = observation({ ...third, observedAt: "2026-09-28T12:00:01.000Z" });
  const second = observation({
    ...(await fixture(2)),
    observedAt: "2026-09-28T12:01:00.000Z",
  });
  const overlap = observation({ ...a, observedAt: "2026-09-28T12:02:00.000Z" });
  const manifest = JSON.parse(
    await readFile(
      "experiments/local-telemetry-system/results/20260928-sync.json",
      "utf8",
    ),
  ).manifest;
  const mixed = observation({
    ...second,
    manifest,
    deployments: ["initial", "changed"],
  });
  const cases: {
    name: string;
    records: Observation[];
    expectedTotal: number | null;
    expectedState: string;
  }[] = [
    {
      name: "observed-zero",
      records: [observation({ ...a, value: 0 })],
      expectedTotal: 0,
      expectedState: "received-disjoint-deltas",
    },
    {
      name: "missing",
      records: [],
      expectedTotal: null,
      expectedState: "no-sample",
    },
    {
      name: "delayed",
      records: [c, a, second],
      expectedTotal: 3,
      expectedState: "received-disjoint-deltas",
    },
    {
      name: "gap",
      records: [a, c],
      expectedTotal: 2,
      expectedState: "received-disjoint-deltas",
    },
    {
      name: "exact-duplicate",
      records: [a, a],
      expectedTotal: 1,
      expectedState: "received-disjoint-deltas",
    },
    {
      name: "overlap",
      records: [a, overlap],
      expectedTotal: null,
      expectedState: "ambiguous-overlap",
    },
    {
      name: "mixed-version",
      records: [a, mixed],
      expectedTotal: 2,
      expectedState: "received-disjoint-deltas",
    },
  ];
  return cases.map((row) => ({
    ...row,
    summary: summarizeObservations(row.records),
  }));
}
