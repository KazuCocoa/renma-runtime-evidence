import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { observation, type Observation, EVIDENCE } from "./record.js";
import { summarizeObservations } from "./summary.js";
import { resolveCandidates } from "./provenance.js";

export async function dashboardData(directory: string) {
  const records: Observation[] = [];
  const environments: {
    version: string;
    operatingSystem: string;
    architecture: string;
    modelTurns: number;
  }[] = [];
  for (const name of ["current", "previous", "docker"]) {
    let text: string;
    try {
      text = await readFile(
        join(directory, `20260928-integration-${name}.json`),
        "utf8",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    const report = JSON.parse(text).integration;
    if (
      !report ||
      !Array.isArray(report.backend?.records) ||
      !/^codex-cli \d+\.\d+\.\d+$/.test(report.version) ||
      !["darwin", "linux"].includes(report.operatingSystem) ||
      !["arm64", "x64"].includes(report.architecture) ||
      !Number.isSafeInteger(report.modelTurns) ||
      report.modelTurns < 0 ||
      report.modelTurns > 60
    )
      throw new Error("Invalid saved report");
    records.push(...report.backend.records.map(observation));
    environments.push({
      version: report.version,
      operatingSystem: report.operatingSystem,
      architecture: report.architecture,
      modelTurns: report.modelTurns,
    });
  }
  const delivery = JSON.parse(
    await readFile(join(directory, "20260928-delivery.json"), "utf8"),
  );
  records.push(...delivery.backend.records.map(observation));
  const phases = [
    "http-503-queued",
    "stored-acknowledgement-lost",
    "tcp-down-retained",
    "backend-restarted-deduplicated",
    "auth-blocked",
    "auth-recovered",
  ];
  if (!Array.isArray(delivery.events) || delivery.events.length > 32)
    throw new Error("Invalid checkpoints");
  const checkpoints: {
    phase: string;
    observedAt: string;
    queued: number;
    backendRecords: number;
    duplicates: number;
  }[] = delivery.events.map((event: Record<string, unknown>) => {
    if (
      !phases.includes(event.phase as string) ||
      typeof event.observedAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(event.observedAt) ||
      !Number.isFinite(Date.parse(event.observedAt)) ||
      ![event.queued, event.backendRecords, event.duplicates].every(
        (n) =>
          typeof n === "number" &&
          Number.isSafeInteger(n) &&
          n >= 0 &&
          n <= 1024,
      )
    )
      throw new Error("Invalid checkpoint");
    return {
      phase: event.phase as string,
      observedAt: event.observedAt,
      queued: event.queued as number,
      backendRecords: event.backendRecords as number,
      duplicates: event.duplicates as number,
    };
  });
  return { records, environments, checkpoints };
}
export async function startDashboard(
  directory: string,
  assets: string,
  port = 0,
) {
  const data = await dashboardData(directory);
  const server = createServer(async (req, res) => {
    try {
      if (req.method !== "GET") {
        res.writeHead(405).end();
        return;
      }
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      res.setHeader(
        "content-security-policy",
        "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      );
      res.setHeader("x-content-type-options", "nosniff");
      if (url.pathname === "/api") {
        const evidence = url.searchParams.get("evidence") ?? "real-cli";
        if (!EVIDENCE.includes(evidence as (typeof EVIDENCE)[number])) {
          res.writeHead(400).end();
          return;
        }
        const parseTime = (key: string, fallback: number) => {
          const value = url.searchParams.get(key);
          if (!value) return fallback;
          if (
            !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?Z$/.test(value) ||
            !Number.isFinite(Date.parse(value))
          )
            throw new Error("Invalid UTC filter");
          return Date.parse(value);
        };
        const start = parseTime("start", -Infinity),
          end = parseTime("end", Infinity);
        if (start > end) throw new Error("Inverted range");
        const rows = data.records.filter(
          (row) =>
            row.evidenceClass === evidence &&
            Date.parse(row.observedAt) >= start &&
            Date.parse(row.observedAt) <= end,
        );
        const timeline = [...rows]
          .sort((a, b) => b.observedAt.localeCompare(a.observedAt))
          .map((row) => ({
            observedAt: row.observedAt,
            skill: row.skill,
            value: row.value,
            producer: row.producer,
            producerEpoch: row.producerEpoch,
            state: resolveCandidates(
              row.manifest,
              row.deployments,
              row.providerLabel,
            ).state,
            candidates: row.manifest.map((m) => ({
              commit: m.sourceCommit,
              deployment: m.deployment,
              matchesGit: m.commitMatchesContent,
            })),
          }));
        res
          .writeHead(200, {
            "content-type": "application/json",
            "cache-control": "no-store",
          })
          .end(
            JSON.stringify({
              evidence,
              environments: data.environments,
              rows: summarizeObservations(rows),
              timeline,
              checkpoints:
                evidence === "synthetic-delivery"
                  ? data.checkpoints.filter(
                      (row) =>
                        Date.parse(row.observedAt) >= start &&
                        Date.parse(row.observedAt) <= end,
                    )
                  : [],
              basis: "saved-receipt-utc-not-execution-time",
            }),
          );
        return;
      }
      const name =
        url.pathname === "/"
          ? "index.html"
          : url.pathname === "/dashboard.js"
            ? "dashboard.js"
            : url.pathname === "/style.css"
              ? "style.css"
              : null;
      if (!name) {
        res.writeHead(404).end();
        return;
      }
      const bytes = await readFile(join(assets, name));
      res
        .writeHead(200, {
          "content-type": name.endsWith("html")
            ? "text/html; charset=utf-8"
            : name.endsWith("css")
              ? "text/css"
              : "text/javascript",
        })
        .end(bytes);
    } catch {
      res.writeHead(400).end("Invalid request");
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Dashboard unavailable");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
if (process.argv[1]?.endsWith("/dashboard.js")) {
  const port = Number(process.argv[2] ?? "18581");
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("Invalid port");
  startDashboard(
    "experiments/local-telemetry-system/results",
    "experiments/local-telemetry-system/dashboard",
    port,
  )
    .then((server) => {
      process.stdout.write(`Local dashboard: ${server.url}\n`);
      process.on("SIGTERM", () => {
        void server.close();
      });
      process.on("SIGINT", () => {
        void server.close();
      });
    })
    .catch(() => {
      process.stderr.write("Dashboard startup failed\n");
      process.exitCode = 1;
    });
}
