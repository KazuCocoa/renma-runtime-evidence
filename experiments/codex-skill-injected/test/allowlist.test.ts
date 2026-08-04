import assert from "node:assert/strict";
import test from "node:test";

import {
  extractAllowlistedObservations,
  SYNTHETIC_SKILL_NAME,
} from "../src/allowlist.js";

const context = {
  codexVersion: "codex-cli 0.146.0",
  observedAt: "2026-08-04T00:00:00.000Z",
  experimentRunId: "00000000-0000-4000-8000-000000000001",
};

function metricPayload(
  metricName: string,
  attributes: Array<{ key: string; value: { stringValue: string } }>,
): unknown {
  return {
    resourceMetrics: [
      {
        resource: {
          attributes: [
            { key: "user.prompt", value: { stringValue: "PRIVATE_PROMPT" } },
            { key: "repository.path", value: { stringValue: "/private/path" } },
          ],
        },
        scopeMetrics: [
          {
            scope: { name: "codex", version: "PRIVATE_SCOPE_DATA" },
            metrics: [
              {
                name: metricName,
                sum: {
                  dataPoints: [
                    {
                      attributes,
                      exemplars: [{ filteredAttributes: "PRIVATE_EXEMPLAR" }],
                      asInt: "1",
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    ],
    transcript: "PRIVATE_TRANSCRIPT",
  };
}

test("retains only the allowlisted synthetic Skill observation", () => {
  const payload = metricPayload("codex.skill.injected", [
    { key: "skill", value: { stringValue: SYNTHETIC_SKILL_NAME } },
    { key: "status", value: { stringValue: "ok" } },
    { key: "prompt", value: { stringValue: "PRIVATE_PROMPT" } },
    { key: "tool.arguments", value: { stringValue: "PRIVATE_TOOL_ARGS" } },
    { key: "env", value: { stringValue: "PRIVATE_ENV" } },
  ]);

  const observations = extractAllowlistedObservations(payload, context);

  assert.deepEqual(observations, [
    {
      schemaVersion: 1,
      provider: "codex",
      observationType: "skill-injected",
      skill: SYNTHETIC_SKILL_NAME,
      status: "ok",
      ...context,
    },
  ]);

  const serialized = JSON.stringify(observations);
  for (const prohibitedValue of [
    "PRIVATE_PROMPT",
    "PRIVATE_TOOL_ARGS",
    "PRIVATE_ENV",
    "PRIVATE_TRANSCRIPT",
    "PRIVATE_EXEMPLAR",
    "/private/path",
  ]) {
    assert.equal(serialized.includes(prohibitedValue), false);
  }
});

test("drops non-target metrics and non-synthetic Skills", () => {
  const wrongMetric = metricPayload("codex.tool.call", [
    { key: "skill", value: { stringValue: SYNTHETIC_SKILL_NAME } },
    { key: "status", value: { stringValue: "ok" } },
  ]);
  const wrongSkill = metricPayload("codex.skill.injected", [
    { key: "skill", value: { stringValue: "user-private-skill" } },
    { key: "status", value: { stringValue: "ok" } },
  ]);

  assert.deepEqual(extractAllowlistedObservations(wrongMetric, context), []);
  assert.deepEqual(extractAllowlistedObservations(wrongSkill, context), []);
});

test("drops every status except the verified ok value", () => {
  for (const unknownStatus of [
    "success",
    "error",
    "user-name-like-value",
    "contains private content",
  ]) {
    const payload = metricPayload("codex.skill.injected", [
      { key: "skill", value: { stringValue: SYNTHETIC_SKILL_NAME } },
      { key: "status", value: { stringValue: unknownStatus } },
    ]);

    assert.deepEqual(extractAllowlistedObservations(payload, context), []);
  }

  assert.deepEqual(extractAllowlistedObservations(null, context), []);
});
