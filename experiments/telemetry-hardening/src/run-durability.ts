import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  readdir,
  stat,
} from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { worker } from "./process.js";
import { fixture } from "./fixtures.js";
import { encodeOtlp } from "../../local-telemetry-system/src/record.js";
let stage = "setup";
async function run() {
  const root = await mkdtemp(join(process.cwd(), ".renma-hardening-"));
  const token = randomBytes(32).toString("hex");
  let backend: Awaited<ReturnType<typeof worker>> | undefined;
  let sender: Awaited<ReturnType<typeof worker>> | undefined;
  const name = `renma-hardening-${Date.now()}`,
    image = "otel/opentelemetry-collector-contrib:0.161.0";
  let owned = false;
  const docker = (args: string[]) => {
    const r = spawnSync("docker", args, {
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 32768,
      env: { ...process.env, RENMA_TEST_TOKEN: token },
    });
    if (r.status !== 0) throw new Error("Docker operation failed");
    return r.stdout.trim();
  };
  const events: unknown[] = [];
  const record = async (phase: string) =>
    events.push({
      phase,
      observedAt: new Date().toISOString(),
      backend: await backend!.request("snapshot"),
      sender: sender ? await sender.request("snapshot") : null,
    });
  try {
    backend = await worker("backend", join(root, "backend.json"), "0", token);
    const endpoint = backend.endpoint!;
    const port = new URL(endpoint).port;
    sender = await worker("sender", join(root, "queue.json"), endpoint, token);
    await backend.request("accept", false);
    await sender.request("enqueue", await fixture(1));
    await sender.request("flush");
    await record("503-before-sender-sigkill");
    await sender.kill();
    sender = await worker("sender", join(root, "queue.json"), endpoint, token);
    await backend.request("accept", true);
    await backend.request("lose-ack");
    await sender.request("flush");
    await record("sender-restarted-stored-ack-lost");
    await backend.kill();
    await delay(150);
    await sender.request("flush");
    events.push({
      phase: "tcp-disconnected-queue-retained",
      observedAt: new Date().toISOString(),
      sender: await sender.request("snapshot"),
    });
    backend = await worker("backend", join(root, "backend.json"), port, token);
    await delay(250);
    await sender.request("flush");
    await record("backend-restarted-exact-retry-deduplicated");
    await sender.kill();
    sender = undefined;
    stage = "persistent-collector";
    await mkdir(join(root, "storage"));
    const config = join(root, "collector.yaml");
    await writeFile(
      config,
      `extensions:\n  file_storage:\n    directory: /state\n    fsync: true\nreceivers:\n  otlp:\n    protocols:\n      http:\n        endpoint: 0.0.0.0:4318\nexporters:\n  otlp_http:\n    endpoint: http://host.docker.internal:${port}\n    encoding: json\n    compression: none\n    headers:\n      Authorization: "Bearer \${env:RENMA_TEST_TOKEN}"\n    retry_on_failure:\n      initial_interval: 1s\n      max_interval: 2s\n      max_elapsed_time: 0s\n    sending_queue:\n      storage: file_storage\n      queue_size: 64\n      num_consumers: 1\nservice:\n  extensions: [file_storage]\n  telemetry:\n    logs:\n      level: error\n  pipelines:\n    logs:\n      receivers: [otlp]\n      exporters: [otlp_http]\n`,
    );
    const start = () => {
      docker([
        "create",
        "--name",
        name,
        "--user",
        `${process.getuid!()}:${process.getgid!()}`,
        "-e",
        "RENMA_TEST_TOKEN",
        "-p",
        "127.0.0.1::4318",
        "-v",
        `${config}:/etc/collector.yaml:ro`,
        "-v",
        `${join(root, "storage")}:/state`,
        image,
        "--config=/etc/collector.yaml",
      ]);
      owned = true;
      docker(["start", name]);
      const bind = docker(["port", name, "4318/tcp"]);
      if (!/^127\.0\.0\.1:\d+$/.test(bind)) throw new Error("Binding");
      return `http://${bind}/v1/logs`;
    };
    let ingress = start();
    await delay(1500);
    const post = async (n: number) => {
      const r = await fetch(ingress, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(encodeOtlp([await fixture(n)])),
        signal: AbortSignal.timeout(3000),
      });
      await r.body?.cancel();
      return r.status;
    };
    await backend.request("accept", false);
    const accepted = [];
    for (let i = 2; i <= 9; i++) accepted.push(await post(i));
    await record("persistent-queue-before-sigkill");
    docker(["kill", name]);
    docker(["rm", name]);
    owned = false;
    const files = await readdir(join(root, "storage"));
    const bytes = (
      await Promise.all(
        files.map(async (f) => (await stat(join(root, "storage", f))).size),
      )
    ).reduce((a, b) => a + b, 0);
    await backend.request("accept", true);
    ingress = start();
    for (
      let i = 0;
      i < 80 && (await backend.request("snapshot")).stored < 9;
      i++
    )
      await delay(250);
    await record("persistent-queue-after-recreate");
    const recovery = await backend.request("snapshot");
    stage = "persistent-queue-saturation";
    docker(["rm", "-f", name]);
    owned = false;
    await writeFile(
      config,
      (await readFile(config, "utf8")).replace(
        "queue_size: 64",
        "queue_size: 4",
      ),
    );
    await backend.request("accept", false);
    ingress = start();
    await delay(1200);
    const saturationStatuses: number[] = [];
    for (let i = 10; i <= 25; i++) saturationStatuses.push(await post(i));
    const acceptedDuringSaturation = saturationStatuses.filter(
      (s) => s === 200,
    ).length;
    await backend.request("accept", true);
    for (
      let i = 0;
      i < 80 &&
      (await backend.request("snapshot")).stored < 9 + acceptedDuringSaturation;
      i++
    )
      await delay(250);
    const saturationStored = (await backend.request("snapshot")).stored - 9;
    const saturation = {
      queueSize: 4,
      submitted: 16,
      statuses: saturationStatuses,
      accepted: acceptedDuringSaturation,
      deliveredAfterRecovery: saturationStored,
      recoveryWindowMs: 20000,
    };
    const imageDigest = docker([
      "image",
      "inspect",
      image,
      "--format",
      "{{index .RepoDigests 0}}",
    ]);
    if (
      !/^otel\/opentelemetry-collector-contrib@sha256:[a-f0-9]{64}$/.test(
        imageDigest,
      )
    )
      throw new Error("Image identity");
    return {
      schemaVersion: "renma.hardening-durability.v1",
      evidenceClass: "synthetic-records-real-os-processes-and-docker",
      modelTurns: 0,
      events,
      saturation,
      persistentCollector: {
        version: "0.161.0",
        imageDigest,
        fsync: true,
        acceptedStatuses: accepted,
        storageFiles: files.length,
        storageBytes: bytes,
        expectedStored: 9,
        actualStored: recovery.stored,
        recoveryWindowMs: 20000,
      },
      limits: { powerLoss: "not-tested", providerExporter: "not-exercised" },
    };
  } finally {
    if (owned) docker(["rm", "-f", name]);
    await sender?.kill();
    await backend?.kill();
    await rm(root, { recursive: true, force: true });
  }
}
run()
  .then((r) => process.stdout.write(JSON.stringify(r, null, 2) + "\n"))
  .catch(() => {
    process.stderr.write(JSON.stringify({ stage, outcome: "failed" }) + "\n");
    process.exitCode = 1;
  });
