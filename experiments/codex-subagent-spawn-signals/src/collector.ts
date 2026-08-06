import { createServer, type Server } from "node:http";

import {
  emptySpawnSignalObservation,
  extractSpawnSignalObservation,
  mergeSpawnSignalObservations,
  type SpawnSignalObservation,
} from "./signals.js";

export const MAX_REQUEST_BYTES = 2 * 1024 * 1024;

export interface LocalCollector {
  endpoint: string;
  closeAndSnapshot(): Promise<SpawnSignalObservation>;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

export async function startLocalCollector(): Promise<LocalCollector> {
  let observation = emptySpawnSignalObservation();
  const inFlightRequests = new Set<Promise<void>>();

  function trackRequest(): () => void {
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

  async function waitForRequests(): Promise<void> {
    while (inFlightRequests.size > 0) {
      await Promise.all(inFlightRequests);
    }
  }

  const server = createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/metrics") {
      response.writeHead(404).end();
      return;
    }

    const completeRequest = trackRequest();
    const chunks: Buffer[] = [];
    let receivedBytes = 0;
    let requestTooLarge = false;

    const discardAbortedRequest = () => {
      chunks.length = 0;
      completeRequest();
    };
    request.once("aborted", discardAbortedRequest);
    request.once("error", discardAbortedRequest);
    response.once("close", completeRequest);

    request.on("data", (chunk: Buffer) => {
      receivedBytes += chunk.length;
      if (requestTooLarge || receivedBytes > MAX_REQUEST_BYTES) {
        requestTooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });

    request.on("end", () => {
      try {
        if (requestTooLarge) {
          response.writeHead(413).end();
          return;
        }

        const payload: unknown = JSON.parse(
          Buffer.concat(chunks).toString("utf8"),
        );
        const requestObservation = extractSpawnSignalObservation(payload);
        observation = mergeSpawnSignalObservations([
          observation,
          requestObservation,
        ]);
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

  let closeAndSnapshotPromise: Promise<SpawnSignalObservation> | undefined;

  async function drainAndSnapshot(): Promise<SpawnSignalObservation> {
    const serverClosed = closeServer(server);
    await waitForRequests();
    await serverClosed;
    await waitForRequests();
    return observation;
  }

  return {
    endpoint: `http://127.0.0.1:${address.port}/v1/metrics`,
    closeAndSnapshot: () => {
      closeAndSnapshotPromise ??= drainAndSnapshot();
      return closeAndSnapshotPromise;
    },
  };
}
