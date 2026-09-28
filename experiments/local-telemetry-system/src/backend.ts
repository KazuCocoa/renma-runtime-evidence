import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { decodeOtlp, observationId } from "./record.js";
import { readRecords, writeRecords } from "./storage.js";
export async function startBackend(path: string, token: string, port = 0) {
  if (!/^[a-f0-9]{64}$/.test(token))
    throw new Error("Expected ephemeral credential");
  let records = readRecords(path);
  let accepting = true,
    dropAcknowledgement = false;
  let received = 0,
    duplicates = 0,
    unauthorized = 0,
    rejected = 0;
  const server = createServer(async (req, res) => {
    if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200).end("{}");
      return;
    }
    if (req.url !== "/v1/logs" || req.method !== "POST") {
      req.resume();
      res.writeHead(404).end();
      return;
    }
    const auth = req.headers.authorization ?? "";
    const expected = `Bearer ${token}`;
    if (
      Buffer.byteLength(auth) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(auth), Buffer.from(expected))
    ) {
      unauthorized++;
      req.resume();
      res.writeHead(401).end();
      return;
    }
    if (!accepting) {
      req.resume();
      res.writeHead(503).end();
      return;
    }
    if (
      req.headers["content-type"]?.split(";")[0] !== "application/json" ||
      (req.headers["content-encoding"] &&
        req.headers["content-encoding"] !== "identity")
    ) {
      req.resume();
      res.writeHead(415).end();
      return;
    }
    try {
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 256 * 1024) throw new Error("Body limit");
        chunks.push(Buffer.from(chunk));
      }
      const incoming = decodeOtlp(
        JSON.parse(Buffer.concat(chunks).toString("utf8")),
      );
      const known = new Set(records.map(observationId));
      const additions = incoming.filter((row) => {
        const id = observationId(row);
        if (known.has(id)) {
          duplicates++;
          return false;
        }
        known.add(id);
        return true;
      });
      const next = [...records, ...additions];
      writeRecords(path, next); // Synchronous atomic commit before acknowledging; serial within this process.
      records = next;
      received += incoming.length;
      if (dropAcknowledgement) {
        dropAcknowledgement = false;
        req.socket.destroy();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" }).end("{}");
    } catch {
      rejected++;
      if (!res.headersSent) res.writeHead(400).end();
      else res.end();
    }
  });
  server.requestTimeout = 5000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Unavailable receiver");
  return {
    endpoint: `http://127.0.0.1:${address.port}/v1/logs`,
    setAccepting: (value: boolean) => {
      accepting = value;
    },
    loseNextAcknowledgement: () => {
      dropAcknowledgement = true;
    },
    snapshot: () => ({
      received,
      duplicates,
      unauthorized,
      rejected,
      records: records.map((row) => ({
        ...row,
        deployments: [...row.deployments],
        manifest: row.manifest.map((m) => ({ ...m })),
      })),
    }),
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
