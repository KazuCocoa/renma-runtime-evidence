import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { startBackend } from "./backend.js";
import { observation, encodeOtlp } from "./record.js";
import { durableSender } from "./sender.js";

let stage = "setup";
let diagnostic: string[] = [];
async function run() {
  if (process.argv.length !== 2) throw new Error("No arguments");
  const root = await mkdtemp(join(process.cwd(), ".renma-delivery-"));
  const token = randomBytes(32).toString("hex");
  const path = join(root, "backend.json"),
    queue = join(root, "queue.json");
  let backend = await startBackend(path, token);
  const port = Number(new URL(backend.endpoint).port);
  const name = `renma-goal-otel-${Date.now()}`;
  let containerOwned = false;
  const image = "otel/opentelemetry-collector:0.161.0";
  const docker = (args: string[]) => {
    const result = spawnSync("docker", args, {
      encoding: "utf8",
      env: { ...process.env, RENMA_RECEIVER_TOKEN: token },
      timeout: 30000,
      maxBuffer: 32768,
    });
    if (result.status !== 0) {
      diagnostic = [
        "mount",
        "permission",
        "invalid",
        "not found",
        "already in use",
        "daemon",
        "denied",
      ].filter((word) => result.stderr.toLowerCase().includes(word));
      throw new Error("Docker command failed");
    }
    return result.stdout.trim();
  };
  try {
    const report = JSON.parse(
      await readFile(
        "experiments/local-telemetry-system/results/20260928-sync.json",
        "utf8",
      ),
    );
    const make = (ordinal: number) =>
      observation({
        schemaVersion: "renma.local-observation.v1",
        producer: "delivery-fixture",
        producerEpoch: "run-1",
        receiverEpoch: "first",
        evidenceClass: "synthetic-delivery",
        observedAt: new Date().toISOString(),
        skill: "renma-usage-alpha",
        providerLabel: "renma-usage-fixture_renma-usage-alpha",
        value: 1,
        aggregation: "delta",
        monotonic: true,
        seriesIdentity: "not-retained",
        intervalStart: String(
          1790575200000000000n + BigInt(ordinal) * 1000000000n,
        ),
        intervalEnd: String(
          1790575201000000000n + BigInt(ordinal) * 1000000000n,
        ),
        deployments: ["initial"],
        manifest: report.manifest,
      });
    const events: {
      phase: string;
      observedAt: string;
      queued: number;
      backendRecords: number;
      duplicates: number;
      state: string;
    }[] = [];
    let sender = durableSender(queue, backend.endpoint, token);
    const checkpoint = (phase: string) =>
      events.push({
        phase,
        observedAt: new Date().toISOString(),
        queued: sender.snapshot().pending,
        backendRecords: backend.snapshot().records.length,
        duplicates: backend.snapshot().duplicates,
        state: sender.snapshot().state,
      });
    sender.enqueue(make(1));
    backend.setAccepting(false);
    await sender.flush();
    checkpoint("http-503-queued");
    sender = durableSender(queue, backend.endpoint, token);
    backend.setAccepting(true);
    backend.loseNextAcknowledgement();
    await sender.flush();
    checkpoint("stored-acknowledgement-lost");
    await backend.close();
    await delay(120);
    await sender.flush();
    checkpoint("tcp-down-retained");
    backend = await startBackend(path, token, port);
    await delay(220);
    await sender.flush();
    checkpoint("backend-restarted-deduplicated");
    sender.setToken("incorrect");
    sender.enqueue(make(2));
    await sender.flush();
    checkpoint("auth-blocked");
    sender.setToken(token);
    await sender.flush();
    checkpoint("auth-recovered");
    stage = "collector-config";
    const config = join(root, "collector.yaml");
    await writeFile(
      config,
      `receivers:\n  otlp:\n    protocols:\n      http:\n        endpoint: 0.0.0.0:4318\nexporters:\n  otlp_http:\n    endpoint: http://host.docker.internal:${port}\n    encoding: json\n    compression: none\n    headers:\n      Authorization: "Bearer \${env:RENMA_RECEIVER_TOKEN}"\n    retry_on_failure:\n      enabled: true\n      initial_interval: 1s\n      max_interval: 2s\n      max_elapsed_time: 15s\n    sending_queue:\n      enabled: true\n      queue_size: 10\nservice:\n  telemetry:\n    logs:\n      level: error\n  pipelines:\n    logs:\n      receivers: [otlp]\n      exporters: [otlp_http]\n`,
    );
    const startCollector = () => {
      docker([
        "create",
        "--name",
        name,
        "-e",
        "RENMA_RECEIVER_TOKEN",
        "-p",
        "127.0.0.1::4318",
        "-v",
        `${config}:/etc/otelcol/config.yaml:ro`,
        image,
        "--config=/etc/otelcol/config.yaml",
      ]);
      containerOwned = true;
      docker(["start", name]);
      const published = docker(["port", name, "4318/tcp"]);
      if (!/^127\.0\.0\.1:[0-9]{1,5}$/.test(published))
        throw new Error("Unexpected binding");
      return `http://${published}/v1/logs`;
    };
    stage = "collector-start";
    let endpoint = startCollector();
    const post = async (ordinal: number) => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(encodeOtlp([make(ordinal)])),
        signal: AbortSignal.timeout(3000),
      });
      const status = response.status;
      await response.body?.cancel();
      return status;
    };
    await delay(1500);
    stage = "collector-forward";
    const firstStatus = await post(3);
    for (let i = 0; i < 40 && backend.snapshot().records.length < 3; i++)
      await delay(250);
    const baselineReceived = backend.snapshot().records.length === 3;
    if (!baselineReceived) throw new Error("Collector forwarding unavailable");
    backend.setAccepting(false);
    const outageStatus = await post(4);
    await delay(1500);
    const duringOutage = backend.snapshot().records.length;
    backend.setAccepting(true);
    for (let i = 0; i < 40 && backend.snapshot().records.length < 4; i++)
      await delay(250);
    const recovered = backend.snapshot().records.length === 4;
    stage = "collector-memory-queue-restart";
    backend.setAccepting(false);
    const beforeKillStatus = await post(5);
    await delay(1000);
    docker(["kill", name]);
    docker(["rm", name]);
    containerOwned = false;
    backend.setAccepting(true);
    endpoint = startCollector();
    await delay(3000);
    const afterCollectorRestart = backend.snapshot().records.length;
    const newTrafficStatus = await post(6);
    for (let i = 0; i < 40 && backend.snapshot().records.length < 5; i++)
      await delay(250);
    const imageDigest = docker([
      "image",
      "inspect",
      image,
      "--format",
      "{{index .RepoDigests 0}}",
    ]);
    if (
      !/^otel\/opentelemetry-collector@sha256:[a-f0-9]{64}$/.test(imageDigest)
    )
      throw new Error("Image identity unavailable");
    return {
      schemaVersion: "renma.local-delivery-evidence.v1",
      evidenceClass: "synthetic-records-real-http-disk-and-docker",
      events,
      collector: {
        version: "0.161.0",
        imageDigest,
        firstStatus,
        baselineReceived,
        outageStatus,
        duringOutage,
        recovered,
        beforeKillStatus,
        afterCollectorRestart,
        newTrafficStatus,
        finalBackendRecords: backend.snapshot().records.length,
        queuePersistence: "memory-only",
        restartRecoveryWindowMs: 3000,
      },
      backend: backend.snapshot(),
      limits: {
        providerMetrics: "not-exercised-by-this-run",
        retries: "wrapper-and-standard-collector-not-codex-exporter",
        persistence:
          "backend-sender-reinitialization-collector-process-restart-not-power-loss",
        scope: "local-HTTP-JSON-not-TLS-or-gRPC",
      },
    };
  } finally {
    if (containerOwned) {
      try {
        docker(["rm", "-f", name]);
      } catch {
        /* owned only */
      }
    }
    await backend.close();
    await rm(root, { recursive: true, force: true });
  }
}
run()
  .then((result) =>
    process.stdout.write(JSON.stringify(result, null, 2) + "\n"),
  )
  .catch(() => {
    process.stderr.write(
      JSON.stringify({
        stage,
        diagnostic,
        outcome: "delivery-experiment-failed",
      }) + "\n",
    );
    process.exitCode = 1;
  });
