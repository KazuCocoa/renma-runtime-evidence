import assert from "node:assert/strict";
import test from "node:test";

import {
  extractAllowlistedSignals,
  isScenarioId,
  normalizeSkillPresence,
  SCENARIO_IDS,
  type AcceptedSkillSignal,
  type SyntheticSkillName,
} from "../src/allowlist.js";

const receivedAt = "2026-08-05T00:00:00.000Z";
const scenario = "explicit-multiple";

type StringAttribute = {
  key: string;
  value: { stringValue: string };
};

function dataPoint(
  skill: string,
  status: string,
  unexpectedAttributes: StringAttribute[] = [],
): unknown {
  return {
    attributes: [
      { key: "skill", value: { stringValue: skill } },
      { key: "status", value: { stringValue: status } },
      ...unexpectedAttributes,
    ],
    exemplars: [{ filteredAttributes: "PRIVATE_EXEMPLAR" }],
    asInt: "1",
  };
}

function metricPayload(points: unknown[]): unknown {
  return {
    resourceMetrics: [
      {
        resource: {
          attributes: [
            { key: "user.prompt", value: { stringValue: "PRIVATE_PROMPT" } },
            {
              key: "repository.path",
              value: { stringValue: "/private/path" },
            },
          ],
        },
        scopeMetrics: [
          {
            scope: { name: "codex", version: "PRIVATE_SCOPE_DATA" },
            metrics: [
              {
                name: "codex.skill.injected",
                sum: { dataPoints: points },
              },
            ],
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

function acceptedSignal(
  skill: SyntheticSkillName,
  signalReceivedAt = receivedAt,
): AcceptedSkillSignal {
  return {
    scenario,
    skill,
    status: "ok",
    receivedAt: signalReceivedAt,
  };
}

test("retains multiple exact synthetic labels as a sorted presence set", () => {
  const payload = metricPayload([
    dataPoint("renma-activation-explicit-beta-20260805", "ok", [
      { key: "prompt", value: { stringValue: "PRIVATE_PROMPT" } },
      { key: "tool.arguments", value: { stringValue: "PRIVATE_TOOL_INPUT" } },
      { key: "env", value: { stringValue: "PRIVATE_ENV" } },
    ]),
    dataPoint("renma-activation-explicit-alpha-20260805", "ok"),
  ]);

  const signals = extractAllowlistedSignals(payload, { scenario, receivedAt });
  const normalized = normalizeSkillPresence(signals);

  assert.deepEqual(normalized, {
    injectedSkills: [
      "renma-activation-explicit-alpha-20260805",
      "renma-activation-explicit-beta-20260805",
    ],
    verifiedStatus: "ok",
    collectorReceipt: { firstAcceptedAt: receivedAt },
  });

  const serialized = JSON.stringify(normalized);
  for (const prohibitedValue of [
    "PRIVATE_PROMPT",
    "PRIVATE_RESPONSE",
    "PRIVATE_REASONING",
    "PRIVATE_TRANSCRIPT",
    "PRIVATE_TOOL_INPUT",
    "PRIVATE_TOOL_OUTPUT",
    "PRIVATE_ENV",
    "PRIVATE_EXEMPLAR",
    "PRIVATE_SCOPE_DATA",
    "/private/path",
  ]) {
    assert.equal(serialized.includes(prohibitedValue), false);
  }
});

test("deduplicates repeated cumulative exports without inferring a count", () => {
  const skill = "renma-activation-explicit-single-20260805";
  const firstExport = extractAllowlistedSignals(
    metricPayload([dataPoint(skill, "ok")]),
    { scenario: "explicit-single", receivedAt },
  );
  const repeatedExport = extractAllowlistedSignals(
    metricPayload([dataPoint(skill, "ok")]),
    {
      scenario: "explicit-single",
      receivedAt: "2026-08-05T00:00:10.000Z",
    },
  );

  assert.deepEqual(
    normalizeSkillPresence([...firstExport, ...repeatedExport]),
    {
      injectedSkills: [skill],
      verifiedStatus: "ok",
      collectorReceipt: { firstAcceptedAt: receivedAt },
    },
  );
});

test("drops unknown Skill labels", () => {
  const payload = metricPayload([
    dataPoint("user-private-skill", "ok"),
    dataPoint("renma-activation-router-target-20260805", "ok"),
  ]);

  assert.deepEqual(
    normalizeSkillPresence(
      extractAllowlistedSignals(payload, {
        scenario: "router-to-target",
        receivedAt,
      }),
    ).injectedSkills,
    ["renma-activation-router-target-20260805"],
  );
});

test("drops every status other than exact ok", () => {
  for (const unknownStatus of [
    "OK",
    "success",
    "error",
    "user-name-like-value",
    "contains private content",
    "",
  ]) {
    const payload = metricPayload([
      dataPoint("renma-activation-explicit-single-20260805", unknownStatus),
    ]);
    assert.deepEqual(
      extractAllowlistedSignals(payload, {
        scenario: "explicit-single",
        receivedAt,
      }),
      [],
    );
  }
});

test("accepts only finite allowlisted scenario identifiers", () => {
  assert.deepEqual(SCENARIO_IDS, [
    "discovered-only",
    "explicit-single",
    "explicit-multiple",
    "router-to-target",
    "implicit-match",
  ]);
  assert.equal(isScenarioId("implicit-match"), true);
  assert.equal(isScenarioId("user-provided-scenario"), false);

  const payload = metricPayload([
    dataPoint("renma-activation-explicit-single-20260805", "ok"),
  ]);
  assert.deepEqual(
    extractAllowlistedSignals(payload, {
      scenario: "user-provided-scenario",
      receivedAt,
    }),
    [],
  );
});

test("represents an empty observation set honestly", () => {
  assert.deepEqual(normalizeSkillPresence([]), { injectedSkills: [] });
});

test("rejects malformed duplicate allowlisted attributes", () => {
  const malformed = metricPayload([
    {
      attributes: [
        {
          key: "skill",
          value: {
            stringValue: "renma-activation-explicit-single-20260805",
          },
        },
        {
          key: "skill",
          value: { stringValue: "renma-activation-dormant-20260805" },
        },
        { key: "status", value: { stringValue: "ok" } },
      ],
    },
  ]);

  assert.deepEqual(
    extractAllowlistedSignals(malformed, {
      scenario: "explicit-single",
      receivedAt,
    }),
    [],
  );
});

test("normalizes synthetic signals without carrying scenario order", () => {
  const normalized = normalizeSkillPresence([
    acceptedSignal("renma-activation-router-target-20260805"),
    acceptedSignal("renma-activation-router-20260805"),
  ]);

  assert.deepEqual(normalized.injectedSkills, [
    "renma-activation-router-20260805",
    "renma-activation-router-target-20260805",
  ]);
});
