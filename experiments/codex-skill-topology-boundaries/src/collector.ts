import { createServer, type Server } from "node:http";

import {
  extractAllowlistedSignals,
  normalizeRuntimePresence,
  type AcceptedSignal,
  type RuntimePresenceSet,
  type ScenarioId,
} from "./allowlist.js";

const MAX_REQUEST_BYTES = 2 * 1024 * 1024;

export interface LocalCollector {
  endpoint: string;
  closeAndSnapshot(): Promise<RuntimePresenceSet>;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

export async function startLocalCollector(
  scenario: ScenarioId,
): Promise<LocalCollector> {
  const signals: AcceptedSignal[] = [];
  const inFlightRequests = new Set<Promise<void>>();

  function trackAcceptedRequest(): () => void {
    let resolveRequest: (() => void) | undefined;
    const requestCompleted = new Promise<void>((resolve) => {
      resolveRequest = resolve;
    });
    inFlightRequests.add(requestCompleted);

    let completed = false;
    return () => {
      if (completed) {
        return;
      }
      completed = true;
      inFlightRequests.delete(requestCompleted);
      resolveRequest?.();
    };
  }

  async function waitForAcceptedRequests(): Promise<void> {
    while (inFlightRequests.size > 0) {
      await Promise.all(inFlightRequests);
    }
  }

  const server = createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/metrics") {
      response.writeHead(404).end();
      return;
    }

    const completeRequest = trackAcceptedRequest();
    let receivedBytes = 0;
    const chunks: Buffer[] = [];

    request.once("aborted", completeRequest);
    request.once("error", completeRequest);
    response.once("close", completeRequest);

    request.on("data", (chunk: Buffer) => {
      receivedBytes += chunk.length;
      if (receivedBytes > MAX_REQUEST_BYTES) {
        chunks.length = 0;
        request.destroy();
        completeRequest();
        return;
      }
      chunks.push(chunk);
    });

    request.on("end", () => {
      if (receivedBytes > MAX_REQUEST_BYTES) {
        completeRequest();
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
        completeRequest();
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

  let closeAndSnapshotPromise: Promise<RuntimePresenceSet> | undefined;

  async function drainAndSnapshot(): Promise<RuntimePresenceSet> {
    const serverClosed = closeServer(server);
    await waitForAcceptedRequests();
    await serverClosed;
    await waitForAcceptedRequests();
    return normalizeRuntimePresence(signals);
  }

  return {
    endpoint: `http://127.0.0.1:${address.port}/v1/metrics`,
    closeAndSnapshot: () => {
      closeAndSnapshotPromise ??= drainAndSnapshot();
      return closeAndSnapshotPromise;
    },
  };
}
