import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, request } from "node:https";
import { startBackend } from "../../local-telemetry-system/src/backend.js";
import {
  encodeOtlp,
  decodeOtlp,
} from "../../local-telemetry-system/src/record.js";
import { fixture } from "./fixtures.js";
let stage = "certificates";
async function run() {
  const root = await mkdtemp(join(tmpdir(), "renma-tls-"));
  const token = randomBytes(32).toString("hex"),
    nextToken = randomBytes(32).toString("hex");
  const backend = await startBackend(join(root, "records.json"), token);
  let server: ReturnType<typeof createServer> | undefined;
  try {
    const openssl = (args: string[]) => {
      const r = spawnSync("openssl", args, {
        cwd: root,
        stdio: "ignore",
        timeout: 15000,
      });
      if (r.status !== 0) throw new Error("Certificate fixture failed");
    };
    openssl([
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      "ca.key",
      "-out",
      "ca.crt",
      "-days",
      "1",
      "-subj",
      "/CN=Renma temporary test CA",
    ]);
    openssl([
      "req",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      "server.key",
      "-out",
      "server.csr",
      "-subj",
      "/CN=localhost",
    ]);
    await writeFile(
      join(root, "extensions.cnf"),
      "subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n",
    );
    openssl([
      "x509",
      "-req",
      "-in",
      "server.csr",
      "-CA",
      "ca.crt",
      "-CAkey",
      "ca.key",
      "-CAcreateserial",
      "-out",
      "server.crt",
      "-days",
      "1",
      "-extfile",
      "extensions.cnf",
    ]);
    const ca = await readFile(join(root, "ca.crt"));
    let activeToken = token,
      authorized = 0,
      rejected = 0,
      delayAck = false;
    server = createServer(
      {
        key: await readFile(join(root, "server.key")),
        cert: await readFile(join(root, "server.crt")),
        minVersion: "TLSv1.2",
      },
      async (req, res) => {
        const expected = Buffer.from(`Bearer ${activeToken}`),
          actual = Buffer.from(req.headers.authorization ?? "");
        if (
          actual.length !== expected.length ||
          !timingSafeEqual(actual, expected)
        ) {
          rejected++;
          req.resume();
          res.writeHead(401).end();
          return;
        }
        if (req.method !== "POST" || req.url !== "/v1/logs") {
          req.resume();
          res.writeHead(404).end();
          return;
        }
        try {
          let size = 0;
          const chunks: Buffer[] = [];
          for await (const c of req) {
            size += c.length;
            if (size > 256 * 1024) throw new Error("Bound");
            chunks.push(Buffer.from(c));
          }
          const reduced = decodeOtlp(
            JSON.parse(Buffer.concat(chunks).toString("utf8")),
          );
          authorized++;
          const response = await fetch(backend.endpoint, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(encodeOtlp(reduced)),
            signal: AbortSignal.timeout(2000),
          });
          await response.body?.cancel();
          const finish = () =>
            res
              .writeHead(response.status, {
                "content-type": "application/json",
              })
              .end("{}");
          if (delayAck) {
            delayAck = false;
            setTimeout(finish, 300);
          } else finish();
        } catch {
          res.writeHead(400).end();
        }
      },
    );
    await new Promise<void>((resolve) =>
      server!.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Address");
    const payload = JSON.stringify(encodeOtlp([await fixture(20)]));
    const send = (
      credential: string | null,
      trusted = true,
      servername = "localhost",
      timeout = 2000,
    ) =>
      new Promise<{ status: number | null; error: string | null }>(
        (resolve) => {
          const req = request(
            {
              hostname: "127.0.0.1",
              port: address.port,
              path: "/v1/logs",
              method: "POST",
              servername,
              ...(trusted ? { ca } : {}),
              rejectUnauthorized: true,
              headers: {
                "content-type": "application/json",
                ...(credential === null
                  ? {}
                  : { authorization: `Bearer ${credential}` }),
              },
            },
            (res) => {
              res.resume();
              res.on("end", () =>
                resolve({ status: res.statusCode ?? null, error: null }),
              );
            },
          );
          req.setTimeout(timeout, () =>
            req.destroy(
              Object.assign(new Error("Timeout"), { code: "TEST_TIMEOUT" }),
            ),
          );
          req.on("error", (e: NodeJS.ErrnoException) =>
            resolve({
              status: null,
              error: [
                "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
                "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
                "SELF_SIGNED_CERT_IN_CHAIN",
                "CERT_HAS_EXPIRED",
                "ERR_TLS_CERT_ALTNAME_INVALID",
                "TEST_TIMEOUT",
              ].includes(e.code ?? "")
                ? e.code!
                : "unclassified",
            }),
          );
          req.end(payload);
        },
      );
    stage = "tls-auth-probes";
    const events: {
      phase: string;
      observedAt: string;
      status: number | null;
      error: string | null;
      stored: number;
    }[] = [];
    const probe = async (phase: string, args: Parameters<typeof send>) => {
      const outcome = await send(...args);
      events.push({
        phase,
        observedAt: new Date().toISOString(),
        ...outcome,
        stored: backend.snapshot().records.length,
      });
      return outcome;
    };
    await probe("unknown-ca-rejected", [token, false]);
    await probe("wrong-hostname-rejected", [token, true, "wrong.invalid"]);
    await probe("missing-credential-rejected", [null]);
    await probe("wrong-credential-rejected", ["incorrect"]);
    await probe("trusted-authenticated-delivery", [token]);
    activeToken = nextToken;
    await probe("old-credential-after-rotation", [token]);
    await probe("new-credential-after-rotation", [nextToken]);
    delayAck = true;
    await probe("timeout-after-storage", [nextToken, true, "localhost", 75]);
    await probe("retry-after-timeout", [nextToken]);
    return {
      schemaVersion: "renma.hardening-security.v1",
      evidenceClass: "synthetic-records-real-local-tls-and-http",
      modelTurns: 0,
      events,
      authorizedRequests: authorized,
      rejectedCredentials: rejected,
      uniqueStored: backend.snapshot().records.length,
      duplicates: backend.snapshot().duplicates,
      verification: {
        rejectUnauthorized: true,
        temporaryCA: true,
        globalTrustModified: false,
      },
      limits: {
        client: "node-https-not-codex-exporter",
        productionReceiver: "not-exercised",
      },
    };
  } finally {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
    await backend.close();
    await rm(root, { recursive: true, force: true });
  }
}
run()
  .then((r) => process.stdout.write(JSON.stringify(r, null, 2) + "\n"))
  .catch(() => {
    process.stderr.write(JSON.stringify({ stage, outcome: "failed" }) + "\n");
    process.exitCode = 1;
  });
