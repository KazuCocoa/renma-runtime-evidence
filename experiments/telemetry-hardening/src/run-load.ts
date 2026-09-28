import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import {
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  renameSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { startBackend } from "../../local-telemetry-system/src/backend.js";
import { durableSender } from "../../local-telemetry-system/src/sender.js";
import { encodeOtlp } from "../../local-telemetry-system/src/record.js";
import { fixture } from "./fixtures.js";
let stage = "inventory";
async function run() {
  const renma = process.argv[2];
  if (!renma || !isAbsolute(renma)) throw new Error("Renma path required");
  const root = await mkdtemp(join(tmpdir(), "renma-load-"));
  let server: ReturnType<typeof createServer> | undefined;
  let backend: Awaited<ReturnType<typeof startBackend>> | undefined;
  try {
    const env = {
      PATH: process.env.PATH,
      HOME: root,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
    };
    const call = (exe: string, args: string[], cwd: string) => {
      const r = spawnSync(exe, args, {
        cwd,
        env,
        encoding: "utf8",
        timeout: 30000,
        maxBuffer: 4 * 1024 * 1024,
      });
      if (r.status !== 0) throw new Error("Catalog control failed");
      return r.stdout;
    };
    const start = performance.now();
    const identities: string[] = [];
    for (let repository = 0; repository < 20; repository++) {
      const dir = join(root, `repository-${repository}`);
      await mkdir(dir);
      call("git", ["init", "-q"], dir);
      for (let local = 0; local < 50; local++) {
        const id = repository * 50 + local,
          name = `renma-load-${id}`;
        const skill = join(dir, "skills", name);
        await mkdir(skill, { recursive: true });
        await writeFile(
          join(skill, "SKILL.md"),
          `---\nname: ${name}\ndescription: Authored load-test fixture only.\nmetadata:\n  renma.id: skill.load-${id}\n---\n\nReturn a brief acknowledgement.\n`,
        );
      }
      const output = JSON.parse(
        call(process.execPath, [renma, "catalog", dir, "--json"], dir),
      );
      const entries = output.catalog?.entries;
      if (
        output.schemaVersion !== "renma.catalog.v1" ||
        !Array.isArray(entries) ||
        entries.length !== 50
      )
        throw new Error("Catalog shape");
      const expected = new Set(
        Array.from(
          { length: 50 },
          (_, i) => `skill.load-${repository * 50 + i}`,
        ),
      );
      for (const entry of entries) {
        if (entry.kind !== "skill" || !expected.delete(entry.id))
          throw new Error("Catalog identity");
        identities.push(entry.id);
      }
      if (expected.size) throw new Error("Missing catalog identities");
    }
    const catalogMs = Math.round(performance.now() - start);
    stage = "concurrent-http";
    type Record = {
      event: number;
      assetId: string;
      repository: number;
      value: 1;
    };
    const records = new Map<number, Record>();
    let duplicates = 0,
      rejected = 0;
    const token = randomBytes(32).toString("hex"),
      file = join(root, "portfolio.json");
    // The registry consists only of the 1,000 exact authored catalog identities above.
    const registry = new Set(identities);
    const reduce = (value: any): Record => {
      if (
        !value ||
        !Number.isInteger(value.event) ||
        value.event < 0 ||
        value.event > 4096 ||
        value.value !== 1
      )
        throw new Error("Unknown event");
      const index = value.event % 1000,
        assetId = `skill.load-${index}`,
        repository = Math.floor(index / 50);
      if (
        value.assetId !== assetId ||
        value.repository !== repository ||
        !registry.has(assetId)
      )
        throw new Error("Unknown identity");
      return { event: value.event, assetId, repository, value: 1 };
    };
    server = createServer(async (req, res) => {
      if (
        req.method !== "POST" ||
        req.url !== "/v1/logs" ||
        req.headers.authorization !== `Bearer ${token}`
      ) {
        req.resume();
        res.writeHead(401).end();
        return;
      }
      try {
        let size = 0;
        const chunks: Buffer[] = [];
        for await (const c of req) {
          size += c.length;
          if (size > 65536) throw new Error("Input bound");
          chunks.push(Buffer.from(c));
        }
        const packet = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const scopes = packet.resourceLogs?.[0]?.scopeLogs;
        if (
          !Array.isArray(packet.resourceLogs) ||
          packet.resourceLogs.length !== 1 ||
          !Array.isArray(scopes) ||
          scopes.length !== 1 ||
          scopes[0]?.scope?.name !== "renma.authored-load"
        )
          throw new Error("Scope");
        const logs = scopes[0].logRecords;
        if (!Array.isArray(logs) || !logs.length || logs.length > 64)
          throw new Error("Batch bound");
        const reduced = logs.map((log: any) => {
          const a = log.attributes;
          if (
            !Array.isArray(a) ||
            a.length !== 1 ||
            a[0]?.key !== "renma.fixture" ||
            typeof a[0]?.value?.stringValue !== "string"
          )
            throw new Error("Attribute");
          return reduce(JSON.parse(a[0].value.stringValue));
        });
        const next = new Map(records);
        let duplicateCount = 0;
        for (const row of reduced) {
          if (next.has(row.event)) duplicateCount++;
          else next.set(row.event, row);
        }
        if (next.size > 4096) {
          res.writeHead(507).end();
          return;
        }
        const fd = openSync(`${file}.tmp`, "w", 0o600);
        try {
          writeFileSync(fd, JSON.stringify([...next.values()]));
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
        renameSync(`${file}.tmp`, file);
        records.clear();
        for (const [key, row] of next) records.set(key, row);
        duplicates += duplicateCount;
        res.writeHead(200, { "content-type": "application/json" }).end("{}");
      } catch {
        rejected++;
        res.writeHead(400).end();
      }
    });
    await new Promise<void>((resolve) =>
      server!.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Address");
    const endpoint = `http://127.0.0.1:${address.port}/v1/logs`;
    const make = (event: number) => ({
      event,
      assetId: `skill.load-${event % 1000}`,
      repository: Math.floor((event % 1000) / 50),
      value: 1,
    });
    const post = async (rows: unknown[]) => {
      const r = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          resourceLogs: [
            {
              scopeLogs: [
                {
                  scope: { name: "renma.authored-load" },
                  logRecords: rows.map((row) => ({
                    attributes: [
                      {
                        key: "renma.fixture",
                        value: { stringValue: JSON.stringify(row) },
                      },
                    ],
                  })),
                },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(10000),
      });
      await r.body?.cancel();
      return r.status;
    };
    const batches = Array.from({ length: 64 }, (_, i) =>
      Array.from({ length: 64 }, (_, j) => ({
        ...make(i * 64 + j),
        rawPrompt: "AUTHORED_SECRET_SENTINEL",
      })),
    );
    const statuses: number[] = [],
      latencies: number[] = [];
    let cursor = 0;
    const started = performance.now();
    await Promise.all(
      Array.from({ length: 8 }, async () => {
        for (;;) {
          const i = cursor++;
          if (i >= batches.length) return;
          const t = performance.now();
          statuses.push(await post(batches[i]!));
          latencies.push(performance.now() - t);
        }
      }),
    );
    const elapsedMs = Math.round(performance.now() - started);
    const replayStatus = await post(batches[0]!);
    const overflowStatus = await post([make(4096)]);
    const beforeInvalid = records.size;
    const unknownStatus = await post([
      { ...make(1), assetId: "not-allowlisted" },
    ]);
    const contaminatedStatus = await post([
      { ...make(1), rawPrompt: "AUTHORED_SECRET_SENTINEL" },
    ]);
    const bytes = await readFile(file, "utf8");
    stage = "existing-component-bounds";
    backend = await startBackend(join(root, "existing.json"), token);
    const seed = await fixture(1);
    const legacy = Array.from({ length: 1025 }, (_, i) => ({
      ...seed,
      intervalStart: String(1790600000000000000n + BigInt(i) * 1000000000n),
      intervalEnd: String(1790600001000000000n + BigInt(i) * 1000000000n),
    }));
    const sender = durableSender(
      join(root, "pending.json"),
      backend.endpoint,
      token,
    );
    for (const row of legacy.slice(0, 256)) sender.enqueue(row);
    let senderOverflowRejected = false;
    try {
      sender.enqueue(legacy[256]);
    } catch {
      senderOverflowRejected = true;
    }
    const legacyStatuses = [];
    for (let i = 0; i < 1024; i += 16) {
      const r = await fetch(backend.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(encodeOtlp(legacy.slice(i, i + 16))),
      });
      legacyStatuses.push(r.status);
      await r.body?.cancel();
    }
    const overflow = await fetch(backend.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(encodeOtlp([legacy[1024]])),
    });
    const legacyOverflowStatus = overflow.status;
    await overflow.body?.cancel();
    latencies.sort((a, b) => a - b);
    return {
      schemaVersion: "renma.hardening-load.v1",
      evidenceClass: "authored-catalog-and-synthetic-real-http-load",
      modelTurns: 0,
      environment: {
        platform: process.platform,
        architecture: process.arch,
        node: process.version,
      },
      inventory: { repositories: 20, skills: identities.length, catalogMs },
      load: {
        concurrency: 8,
        requests: statuses.length,
        allAccepted: statuses.every((s) => s === 200),
        elapsedMs,
        p50Ms: Math.round(latencies[Math.floor(latencies.length * 0.5)]!),
        p95Ms: Math.round(latencies[Math.floor(latencies.length * 0.95)]!),
        uniqueStored: records.size,
        distinctSkills: new Set([...records.values()].map((r) => r.assetId))
          .size,
        storageBytes: (await stat(file)).size,
        duplicates,
        replayStatus,
        overflowStatus,
        unknownStatus,
        contaminatedStatus,
        invalidChangedStorage: records.size !== beforeInvalid,
        sentinelPersisted: bytes.includes("AUTHORED_SECRET_SENTINEL"),
        rejected,
      },
      existingComponentBounds: {
        senderCapacity: 256,
        senderOverflowRejected,
        backendCapacity: 1024,
        allWithinCapacityAccepted: legacyStatuses.every((s) => s === 200),
        overflowStatus: legacyOverflowStatus,
        stored: backend.snapshot().records.length,
      },
      limits: {
        portfolioReceiver:
          "authored-indexed-envelope-prototype-not-existing-two-skill-schema",
        providerRuntimeLoad: "not-exercised",
        capacity: "local-measurement-not-production-sizing",
      },
    };
  } finally {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
    await backend?.close();
    await rm(root, { recursive: true, force: true });
  }
}
run()
  .then((r) => process.stdout.write(JSON.stringify(r, null, 2) + "\n"))
  .catch(() => {
    process.stderr.write(JSON.stringify({ stage, outcome: "failed" }) + "\n");
    process.exitCode = 1;
  });
