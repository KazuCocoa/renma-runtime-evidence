import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDashboard } from "../../local-telemetry-system/src/dashboard.js";
import { aggregationCases } from "./aggregation.js";
const servers: Awaited<ReturnType<typeof startDashboard>>[] = [];
const root = await mkdtemp(join(tmpdir(), "renma-dashboard-cases-"));
try {
  const cases = await aggregationCases();
  for (const [index, row] of cases.entries()) {
    const path = join(root, row.name);
    await mkdir(path);
    await writeFile(
      join(path, "20260928-delivery.json"),
      JSON.stringify({ backend: { records: row.records }, events: [] }),
    );
    const server = await startDashboard(
      path,
      "experiments/local-telemetry-system/dashboard",
      18582 + index,
    );
    servers.push(server);
    const result = await fetch(
      `${server.url}/api?evidence=synthetic-delivery`,
    ).then((r) => r.json());
    if (
      result.rows[0].total !== row.expectedTotal ||
      result.rows[0].countState !== row.expectedState
    )
      throw new Error("Aggregation mismatch");
  }
  const result = {
    schemaVersion: "renma.hardening-aggregation.v1",
    evidenceClass: "authored-synthetic-boundaries-existing-dashboard",
    modelTurns: 0,
    cases: cases.map((row) => ({
      name: row.name,
      expectedTotal: row.expectedTotal,
      expectedState: row.expectedState,
      summary: row.summary,
    })),
    limits: { timestamps: "authored-not-new-provider-observations" },
  };
  await writeFile(
    "experiments/telemetry-hardening/results/20260928-aggregation.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  process.stdout.write(
    JSON.stringify({
      ready: true,
      cases: cases.map((r, i) => ({ name: r.name, url: servers[i]!.url })),
    }) + "\n",
  );
  const close = async () => {
    for (const server of servers) await server.close();
    await rm(root, { recursive: true, force: true });
  };
  process.on("SIGTERM", () => {
    void close();
  });
  process.on("SIGINT", () => {
    void close();
  });
} catch {
  for (const server of servers) await server.close();
  await rm(root, { recursive: true, force: true });
  process.stderr.write("Dashboard case setup failed\n");
  process.exitCode = 1;
}
