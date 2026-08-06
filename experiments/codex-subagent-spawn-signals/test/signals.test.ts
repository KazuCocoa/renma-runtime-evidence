import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  emptySpawnSignalObservation,
  extractSpawnSignalObservation,
  mergeSpawnSignalObservations,
  SCENARIO_IDS,
  SPAWN_ROLE_CLASSIFICATIONS,
  SYNTHETIC_AGENT_ROLES,
  TARGET_SPAWN_METRIC_NAME,
} from "../src/signals.js";

const allowlistedRole = "renma_spawn_signal_worker_20260806";
const unknownRole = "SENTINEL_UNKNOWN_ROLE_7F83C2A9";

function roleAttribute(value: unknown): unknown {
  return { key: "role", value };
}

function stringRoleAttribute(role: string): unknown {
  return roleAttribute({ stringValue: role });
}

function spawnPoint(attributes: unknown[] | undefined): unknown {
  return {
    ...(attributes === undefined ? {} : { attributes }),
    asInt: "31",
    exemplars: [{ value: "PRIVATE_EXEMPLAR" }],
    agentId: "PRIVATE_AGENT_ID",
    threadId: "PRIVATE_THREAD_ID",
    parentThreadId: "PRIVATE_PARENT_THREAD_ID",
  };
}

function payloadWithMetrics(metrics: unknown[]): unknown {
  return {
    resourceMetrics: [
      {
        resource: {
          attributes: [
            {
              key: "repository.path",
              value: { stringValue: "/PRIVATE/REPOSITORY/PATH" },
            },
          ],
        },
        scopeMetrics: [
          {
            scope: { name: "PRIVATE_SCOPE", version: "PRIVATE_VERSION" },
            metrics,
          },
        ],
      },
    ],
    prompt: "PRIVATE_PROMPT",
    response: "PRIVATE_RESPONSE",
    reasoning: "PRIVATE_REASONING",
    transcript: "PRIVATE_TRANSCRIPT",
    toolInput: "PRIVATE_TOOL_INPUT",
    toolOutput: "PRIVATE_TOOL_OUTPUT",
  };
}

function spawnMetric(dataPoints?: unknown[]): unknown {
  return {
    name: TARGET_SPAWN_METRIC_NAME,
    sum: dataPoints === undefined ? {} : { dataPoints },
  };
}

test("matches only the exact spawn metric name", () => {
  const observation = extractSpawnSignalObservation(
    payloadWithMetrics([
      {
        name: `${TARGET_SPAWN_METRIC_NAME}.suffix`,
        sum: {
          dataPoints: [spawnPoint([stringRoleAttribute(allowlistedRole)])],
        },
      },
      {
        name: "multi_agent.spawn",
        sum: {
          dataPoints: [spawnPoint([stringRoleAttribute(allowlistedRole)])],
        },
      },
    ]),
  );

  assert.deepEqual(observation, emptySpawnSignalObservation());
});

test("distinguishes an observed metric with no data points", () => {
  assert.deepEqual(
    extractSpawnSignalObservation(payloadWithMetrics([spawnMetric([])])),
    {
      spawnMetricObserved: true,
      spawnDataPointObserved: false,
      spawnRoleClassifications: [],
      spawnedRoles: [],
    },
  );
  assert.deepEqual(
    extractSpawnSignalObservation(
      payloadWithMetrics([{ name: TARGET_SPAWN_METRIC_NAME }]),
    ),
    {
      spawnMetricObserved: true,
      spawnDataPointObserved: false,
      spawnRoleClassifications: [],
      spawnedRoles: [],
    },
  );
});

test("retains only exact finite allowlisted roles", () => {
  assert.deepEqual(
    extractSpawnSignalObservation(
      payloadWithMetrics([
        spawnMetric([spawnPoint([stringRoleAttribute(allowlistedRole)])]),
      ]),
    ),
    {
      spawnMetricObserved: true,
      spawnDataPointObserved: true,
      spawnRoleClassifications: ["allowlisted-role"],
      spawnedRoles: [allowlistedRole],
    },
  );
});

test("classifies a non-allowlisted role without retaining or transforming it", () => {
  const observation = extractSpawnSignalObservation(
    payloadWithMetrics([
      spawnMetric([spawnPoint([stringRoleAttribute(unknownRole)])]),
    ]),
  );
  const serialized = JSON.stringify(observation);
  const derivedSentinels = [
    unknownRole,
    Buffer.from(unknownRole, "utf8").toString("base64"),
    Buffer.from(unknownRole, "utf8").toString("hex"),
    createHash("sha256").update(unknownRole).digest("hex"),
  ];

  assert.deepEqual(observation, {
    spawnMetricObserved: true,
    spawnDataPointObserved: true,
    spawnRoleClassifications: ["non-allowlisted-role"],
    spawnedRoles: [],
  });
  for (const sentinel of derivedSentinels) {
    assert.equal(serialized.includes(sentinel), false);
  }
});

test("classifies missing, non-string, and duplicate role attributes", () => {
  const observation = extractSpawnSignalObservation(
    payloadWithMetrics([
      spawnMetric([
        spawnPoint(undefined),
        spawnPoint([roleAttribute({ intValue: "7" })]),
        spawnPoint([
          stringRoleAttribute(allowlistedRole),
          stringRoleAttribute("renma_spawn_signal_alpha_20260806"),
        ]),
      ]),
    ]),
  );

  assert.deepEqual(observation, {
    spawnMetricObserved: true,
    spawnDataPointObserved: true,
    spawnRoleClassifications: [
      "duplicate-role-attribute",
      "missing-role",
      "non-string-role",
    ],
    spawnedRoles: [],
  });
});

test("normalizes mixed cumulative exports into sorted deduplicated presence sets", () => {
  const first = extractSpawnSignalObservation(
    payloadWithMetrics([
      spawnMetric([
        spawnPoint([stringRoleAttribute("renma_spawn_signal_beta_20260806")]),
        spawnPoint([stringRoleAttribute(unknownRole)]),
      ]),
    ]),
  );
  const cumulative = extractSpawnSignalObservation(
    payloadWithMetrics([
      spawnMetric([
        spawnPoint([stringRoleAttribute("renma_spawn_signal_beta_20260806")]),
        spawnPoint([stringRoleAttribute("renma_spawn_signal_alpha_20260806")]),
        spawnPoint([stringRoleAttribute(unknownRole)]),
        spawnPoint(undefined),
      ]),
    ]),
  );

  assert.deepEqual(mergeSpawnSignalObservations([first, cumulative]), {
    spawnMetricObserved: true,
    spawnDataPointObserved: true,
    spawnRoleClassifications: [
      "allowlisted-role",
      "missing-role",
      "non-allowlisted-role",
    ],
    spawnedRoles: [
      "renma_spawn_signal_alpha_20260806",
      "renma_spawn_signal_beta_20260806",
    ],
  });
});

test("rejects malformed payload envelopes and target metric shapes", () => {
  assert.throws(
    () => extractSpawnSignalObservation(null),
    /Malformed OTLP JSON payload/,
  );
  assert.throws(
    () => extractSpawnSignalObservation({ resourceMetrics: {} }),
    /Malformed OTLP JSON payload/,
  );
  assert.throws(
    () =>
      extractSpawnSignalObservation(
        payloadWithMetrics([
          { name: TARGET_SPAWN_METRIC_NAME, sum: { dataPoints: {} } },
        ]),
      ),
    /Malformed OTLP JSON payload/,
  );
  assert.throws(
    () =>
      extractSpawnSignalObservation(
        payloadWithMetrics([
          spawnMetric([{ attributes: "not-an-attribute-array" }]),
        ]),
      ),
    /Malformed OTLP JSON payload/,
  );
});

test("drops content, attributes, values, counter data, exemplars, and identifiers", () => {
  const observation = extractSpawnSignalObservation(
    payloadWithMetrics([
      spawnMetric([
        spawnPoint([
          stringRoleAttribute(allowlistedRole),
          {
            key: "nickname",
            value: { stringValue: "PRIVATE_NICKNAME" },
          },
          {
            key: "user.prompt",
            value: { stringValue: "PRIVATE_ATTRIBUTE_PROMPT" },
          },
        ]),
      ]),
      {
        name: "codex.skill.injected",
        sum: {
          dataPoints: [
            {
              attributes: [
                {
                  key: "skill",
                  value: { stringValue: "PRIVATE_SKILL" },
                },
              ],
            },
          ],
        },
      },
    ]),
  );
  const serialized = JSON.stringify(observation);

  for (const prohibited of [
    "PRIVATE_PROMPT",
    "PRIVATE_RESPONSE",
    "PRIVATE_REASONING",
    "PRIVATE_TRANSCRIPT",
    "PRIVATE_TOOL_INPUT",
    "PRIVATE_TOOL_OUTPUT",
    "PRIVATE_ATTRIBUTE_PROMPT",
    "PRIVATE_NICKNAME",
    "PRIVATE_EXEMPLAR",
    "PRIVATE_AGENT_ID",
    "PRIVATE_THREAD_ID",
    "PRIVATE_PARENT_THREAD_ID",
    "PRIVATE_SCOPE",
    "PRIVATE_VERSION",
    "PRIVATE_SKILL",
    "/PRIVATE/REPOSITORY/PATH",
    '"31"',
  ]) {
    assert.equal(serialized.includes(prohibited), false);
  }
  assert.equal("injectedSkills" in observation, false);
});

test("exposes only finite scenario, role, and classification domains", () => {
  assert.equal(SCENARIO_IDS.length, 4);
  assert.equal(SYNTHETIC_AGENT_ROLES.length, 5);
  assert.deepEqual(SPAWN_ROLE_CLASSIFICATIONS, [
    "allowlisted-role",
    "non-allowlisted-role",
    "missing-role",
    "non-string-role",
    "duplicate-role-attribute",
  ]);
});
