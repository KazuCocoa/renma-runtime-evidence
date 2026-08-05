import { createServer, type Server } from "node:http";

import {
  extractAllowlistedSignals,
  normalizeSkillPresence,
  type AcceptedSkillSignal,
  type ScenarioId,
  type SkillPresenceSet,
} from "./allowlist.js";

const MAX_REQUEST_BYTES = 2 * 1024 * 1024;

export interface LocalCollector {
  endpoint: string;
  snapshot(): SkillPresenceSet;
  close(): Promise<void>;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

export async function startLocalCollector(
  scenario: ScenarioId,
): Promise<LocalCollector> {
  const signals: AcceptedSkillSignal[] = [];

  const server = createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/metrics") {
      response.writeHead(404).end();
      return;
    }

    let receivedBytes = 0;
    const chunks: Buffer[] = [];

    request.on("data", (chunk: Buffer) => {
      receivedBytes += chunk.length;
      if (receivedBytes > MAX_REQUEST_BYTES) {
        chunks.length = 0;
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });

    request.on("end", () => {
      if (receivedBytes > MAX_REQUEST_BYTES) {
        return;
      }

      try {
        const payload: unknown = JSON.parse(
          Buffer.concat(chunks).toString("utf8"),
        );
        signals.push(
          ...extractAllowlistedSignals(payload, {
            scenario,
            receivedAt: new Date().toISOString(),
          }),
        );
        response.writeHead(200, { "content-type": "application/json" });
        response.end("{}\n");
      } catch {
        response.writeHead(400).end();
      } finally {
        chunks.length = 0;
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    await closeServer(server);
    throw new Error("Collector did not receive a TCP address");
  }

  return {
    endpoint: `http://127.0.0.1:${address.port}/v1/metrics`,
    snapshot: () => normalizeSkillPresence(signals),
    close: () => closeServer(server),
  };
}
