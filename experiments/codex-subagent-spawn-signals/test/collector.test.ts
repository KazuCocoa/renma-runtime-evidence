import assert from "node:assert/strict";
import { request, type ClientRequest } from "node:http";
import test from "node:test";

import { MAX_REQUEST_BYTES, startLocalCollector } from "../src/collector.js";

const allowlistedRole = "renma_spawn_signal_worker_20260806";

function payload(role = allowlistedRole): string {
  return JSON.stringify({
    resourceMetrics: [
      {
        scopeMetrics: [
          {
            metrics: [
              {
                name: "codex.multi_agent.spawn",
                sum: {
                  dataPoints: [
                    {
                      attributes: [
                        { key: "role", value: { stringValue: role } },
                      ],
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    ],
  });
}

function post(endpoint: string, body: string): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const clientRequest = request(
      endpoint,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          connection: "close",
        },
      },
      (response) => {
        response.once("error", reject);
        response.resume();
        response.once("end", () => resolve(response.statusCode));
      },
    );
    clientRequest.once("error", reject);
    clientRequest.end(body);
  });
}

test("rejects malformed payloads without changing the finite snapshot", async () => {
  const collector = await startLocalCollector();
  try {
    assert.equal(await post(collector.endpoint, "not-json"), 400);
    assert.equal(
      await post(
        collector.endpoint,
        JSON.stringify({ resourceMetrics: "malformed" }),
      ),
      400,
    );
    assert.deepEqual(await collector.closeAndSnapshot(), {
      spawnMetricObserved: false,
      spawnDataPointObserved: false,
      spawnRoleClassifications: [],
      spawnedRoles: [],
    });
  } finally {
    await collector.closeAndSnapshot();
  }
});

test("enforces the bounded request size without retaining a partial body", async () => {
  const collector = await startLocalCollector();
  const oversizedBody = "x".repeat(MAX_REQUEST_BYTES + 1);
  try {
    assert.equal(await post(collector.endpoint, oversizedBody), 413);
    assert.deepEqual(await collector.closeAndSnapshot(), {
      spawnMetricObserved: false,
      spawnDataPointObserved: false,
      spawnRoleClassifications: [],
      spawnedRoles: [],
    });
  } finally {
    await collector.closeAndSnapshot();
  }
});

test("drains an accepted in-flight request before taking its snapshot", async () => {
  const collector = await startLocalCollector();
  const body = payload();
  let clientRequest: ClientRequest | undefined;

  try {
    let acceptRequest: (() => void) | undefined;
    let rejectAcceptance: ((error: Error) => void) | undefined;
    const requestAccepted = new Promise<void>((resolve, reject) => {
      acceptRequest = resolve;
      rejectAcceptance = reject;
    });
    let finishResponse: (() => void) | undefined;
    let rejectResponse: ((error: Error) => void) | undefined;
    const responseFinished = new Promise<void>((resolve, reject) => {
      finishResponse = resolve;
      rejectResponse = reject;
    });

    clientRequest = request(
      collector.endpoint,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          connection: "close",
          expect: "100-continue",
        },
      },
      (response) => {
        response.once("error", (error) => rejectResponse?.(error));
        response.resume();
        response.once("end", () => finishResponse?.());
      },
    );
    clientRequest.once("continue", () => acceptRequest?.());
    clientRequest.once("error", (error) => {
      rejectAcceptance?.(error);
      rejectResponse?.(error);
    });
    clientRequest.flushHeaders();

    await requestAccepted;
    const shutdown = collector.closeAndSnapshot();
    clientRequest.end(body);
    await responseFinished;

    const observation = await shutdown;
    assert.deepEqual(observation, {
      spawnMetricObserved: true,
      spawnDataPointObserved: true,
      spawnRoleClassifications: ["allowlisted-role"],
      spawnedRoles: [allowlistedRole],
    });
    assert.strictEqual(await collector.closeAndSnapshot(), observation);
  } finally {
    clientRequest?.destroy();
    await collector.closeAndSnapshot();
  }
});

test("deduplicates observations across accepted cumulative requests", async () => {
  const collector = await startLocalCollector();
  try {
    assert.equal(await post(collector.endpoint, payload()), 200);
    assert.equal(await post(collector.endpoint, payload()), 200);
    assert.deepEqual(await collector.closeAndSnapshot(), {
      spawnMetricObserved: true,
      spawnDataPointObserved: true,
      spawnRoleClassifications: ["allowlisted-role"],
      spawnedRoles: [allowlistedRole],
    });
  } finally {
    await collector.closeAndSnapshot();
  }
});
