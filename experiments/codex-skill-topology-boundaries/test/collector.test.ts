import assert from "node:assert/strict";
import { request, type ClientRequest } from "node:http";
import test from "node:test";

import { startLocalCollector } from "../src/collector.js";

const syntheticSkill = "renma-topology-child-single-20260806";
const syntheticRole = "renma_topology_worker_20260806";

function allowlistedPayload(): string {
  return JSON.stringify({
    resourceMetrics: [
      {
        scopeMetrics: [
          {
            metrics: [
              {
                name: "codex.skill.injected",
                sum: {
                  dataPoints: [
                    {
                      attributes: [
                        {
                          key: "skill",
                          value: { stringValue: syntheticSkill },
                        },
                        {
                          key: "status",
                          value: { stringValue: "ok" },
                        },
                      ],
                    },
                  ],
                },
              },
              {
                name: "codex.multi_agent.spawn",
                sum: {
                  dataPoints: [
                    {
                      attributes: [
                        {
                          key: "role",
                          value: { stringValue: syntheticRole },
                        },
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

test("closeAndSnapshot drains an accepted in-flight metrics request", async () => {
  const collector = await startLocalCollector("subagent-single-skill");
  const payload = allowlistedPayload();
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
          "content-length": Buffer.byteLength(payload),
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
    clientRequest.end(payload);

    await responseFinished;
    const presence = await shutdown;

    assert.deepEqual(presence.injectedSkills, [syntheticSkill]);
    assert.deepEqual(presence.spawnedRoles, [syntheticRole]);
    assert.equal(presence.verifiedSkillStatus, "ok");
    assert.match(
      presence.collectorReceipt?.firstAcceptedAt ?? "",
      /^\d{4}-\d{2}-\d{2}T/,
    );
    assert.strictEqual(await collector.closeAndSnapshot(), presence);
  } finally {
    clientRequest?.destroy();
    await collector.closeAndSnapshot();
  }
});
