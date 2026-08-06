import assert from "node:assert/strict";
import test from "node:test";

import {
  extractAllowlistedSignals,
  isScenarioId,
  isSyntheticAgentRole,
  isSyntheticSkillName,
  normalizeRuntimePresence,
  SCENARIO_IDS,
  SYNTHETIC_AGENT_ROLES,
  SYNTHETIC_SKILL_NAMES,
  type AcceptedSignal,
  type SyntheticAgentRole,
  type SyntheticSkillName,
} from "../src/allowlist.js";

const receivedAt = "2026-08-06T00:00:00.000Z";
const scenario = "nested-chain-depth-3";

type StringAttribute = {
  key: string;
  value: { stringValue: string };
};

function skillPoint(
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
    asInt: "17",
    exemplars: [{ filteredAttributes: "PRIVATE_EXEMPLAR" }],
    threadId: "PRIVATE_THREAD_ID",
  };
}

function spawnPoint(
  role: string,
  unexpectedAttributes: StringAttribute[] = [],
): unknown {
  return {
    attributes: [
      { key: "role", value: { stringValue: role } },
      ...unexpectedAttributes,
    ],
    asInt: "23",
    exemplars: [{ filteredAttributes: "PRIVATE_SPAWN_EXEMPLAR" }],
    agentId: "PRIVATE_AGENT_ID",
    parentThreadId: "PRIVATE_PARENT_THREAD_ID",
  };
}

function metricPayload(options: {
  skillPoints?: unknown[];
  spawnPoints?: unknown[];
}): unknown {
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
                name: "codex.skill.injected",
                sum: { dataPoints: options.skillPoints ?? [] },
              },
              {
                name: "codex.multi_agent.spawn",
                sum: { dataPoints: options.spawnPoints ?? [] },
              },
              {
                name: "codex.content.bearing.metric",
                sum: {
                  dataPoints: [
                    {
                      attributes: [
                        {
                          key: "response",
                          value: { stringValue: "PRIVATE_RESPONSE" },
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
    prompt: "PRIVATE_PROMPT",
    response: "PRIVATE_RESPONSE",
    reasoning: "PRIVATE_REASONING",
    transcript: "PRIVATE_TRANSCRIPT",
    toolInput: "PRIVATE_TOOL_INPUT",
    toolOutput: "PRIVATE_TOOL_OUTPUT",
  };
}

function acceptedSkill(
  skill: SyntheticSkillName,
  signalReceivedAt = receivedAt,
): AcceptedSignal {
  return {
    kind: "skill",
    scenario,
    skill,
    status: "ok",
    receivedAt: signalReceivedAt,
  };
}

function acceptedRole(
  role: SyntheticAgentRole,
  signalReceivedAt = receivedAt,
): AcceptedSignal {
  return {
    kind: "spawn",
    scenario,
    role,
    receivedAt: signalReceivedAt,
  };
}

test("normalizes exact nested synthetic Skill labels into a sorted set", () => {
  const payload = metricPayload({
    skillPoints: [
      skillPoint("renma-topology-depth3-level3-20260806", "ok"),
      skillPoint("renma-topology-depth3-root-20260806", "ok"),
      skillPoint("renma-topology-depth3-level1-20260806", "ok"),
      skillPoint("renma-topology-depth3-level2-20260806", "ok"),
    ],
  });

  const normalized = normalizeRuntimePresence(
    extractAllowlistedSignals(payload, { scenario, receivedAt }),
  );

  assert.deepEqual(normalized, {
    injectedSkills: [
      "renma-topology-depth3-level1-20260806",
      "renma-topology-depth3-level2-20260806",
      "renma-topology-depth3-level3-20260806",
      "renma-topology-depth3-root-20260806",
    ],
    spawnedRoles: [],
    verifiedSkillStatus: "ok",
    collectorReceipt: { firstAcceptedAt: receivedAt },
  });
});

test("deduplicates repeated cumulative exports without retaining counts", () => {
  const skill = "renma-topology-depth2-root-20260806";
  const role = "renma_topology_chain_worker_20260806";
  const firstExport = extractAllowlistedSignals(
    metricPayload({
      skillPoints: [skillPoint(skill, "ok")],
      spawnPoints: [spawnPoint(role)],
    }),
    { scenario: "subagent-nested-chain", receivedAt },
  );
  const cumulativeExport = extractAllowlistedSignals(
    metricPayload({
      skillPoints: [skillPoint(skill, "ok")],
      spawnPoints: [spawnPoint(role)],
    }),
    {
      scenario: "subagent-nested-chain",
      receivedAt: "2026-08-06T00:00:01.000Z",
    },
  );

  const normalized = normalizeRuntimePresence([
    ...firstExport,
    ...cumulativeExport,
  ]);
  assert.deepEqual(normalized.injectedSkills, [skill]);
  assert.deepEqual(normalized.spawnedRoles, [role]);
  assert.equal("count" in normalized, false);
  assert.equal("value" in normalized, false);
});

test("normalizes exact synthetic spawn roles into a sorted set", () => {
  const payload = metricPayload({
    spawnPoints: [
      spawnPoint("renma_topology_beta_20260806"),
      spawnPoint("renma_topology_alpha_20260806"),
    ],
  });

  assert.deepEqual(
    normalizeRuntimePresence(
      extractAllowlistedSignals(payload, {
        scenario: "subagent-parallel",
        receivedAt,
      }),
    ),
    {
      injectedSkills: [],
      spawnedRoles: [
        "renma_topology_alpha_20260806",
        "renma_topology_beta_20260806",
      ],
      collectorReceipt: { firstAcceptedAt: receivedAt },
    },
  );
});

test("discards unknown Skill names, roles, and statuses", () => {
  const payload = metricPayload({
    skillPoints: [
      skillPoint("user-skill", "ok"),
      skillPoint("renma-topology-child-single-20260806", "error"),
      skillPoint("renma-topology-child-single-20260806", "OK"),
      skillPoint("renma-topology-child-single-20260806", ""),
    ],
    spawnPoints: [spawnPoint("worker"), spawnPoint("user_role")],
  });

  assert.deepEqual(
    extractAllowlistedSignals(payload, {
      scenario: "subagent-single-skill",
      receivedAt,
    }),
    [],
  );
});

test("rejects malformed duplicate allowlisted attributes", () => {
  const payload = metricPayload({
    skillPoints: [
      {
        attributes: [
          {
            key: "skill",
            value: {
              stringValue: "renma-topology-child-single-20260806",
            },
          },
          {
            key: "skill",
            value: { stringValue: "renma-topology-child-alpha-20260806" },
          },
          { key: "status", value: { stringValue: "ok" } },
        ],
      },
      {
        attributes: [
          {
            key: "skill",
            value: {
              stringValue: "renma-topology-child-single-20260806",
            },
          },
          { key: "status", value: { stringValue: "ok" } },
          { key: "status", value: { stringValue: "ok" } },
        ],
      },
    ],
    spawnPoints: [
      {
        attributes: [
          {
            key: "role",
            value: { stringValue: "renma_topology_alpha_20260806" },
          },
          {
            key: "role",
            value: { stringValue: "renma_topology_beta_20260806" },
          },
        ],
      },
    ],
  });

  assert.deepEqual(
    extractAllowlistedSignals(payload, {
      scenario: "subagent-parallel",
      receivedAt,
    }),
    [],
  );
});

test("keeps Skill and spawn metrics as unassociated presence sets", () => {
  const normalized = normalizeRuntimePresence([
    acceptedRole("renma_topology_worker_20260806"),
    acceptedSkill("renma-topology-child-single-20260806"),
    acceptedSkill("renma-topology-orchestrator-single-20260806"),
  ]);

  assert.deepEqual(normalized.injectedSkills, [
    "renma-topology-child-single-20260806",
    "renma-topology-orchestrator-single-20260806",
  ]);
  assert.deepEqual(normalized.spawnedRoles, ["renma_topology_worker_20260806"]);
  for (const prohibitedKey of [
    "agentId",
    "threadId",
    "parentThreadId",
    "edges",
    "associations",
    "order",
  ]) {
    assert.equal(prohibitedKey in normalized, false);
  }
});

test("represents empty Skill and role sets honestly", () => {
  assert.deepEqual(normalizeRuntimePresence([]), {
    injectedSkills: [],
    spawnedRoles: [],
  });
});

test("drops content-bearing and unexpected fields before normalization", () => {
  const payload = metricPayload({
    skillPoints: [
      skillPoint("renma-topology-child-alpha-20260806", "ok", [
        { key: "prompt", value: { stringValue: "PRIVATE_PROMPT" } },
        { key: "response", value: { stringValue: "PRIVATE_RESPONSE" } },
        { key: "thread.id", value: { stringValue: "PRIVATE_THREAD_ID" } },
      ]),
    ],
    spawnPoints: [
      spawnPoint("renma_topology_alpha_20260806", [
        { key: "nickname", value: { stringValue: "PRIVATE_NICKNAME" } },
        { key: "agent.id", value: { stringValue: "PRIVATE_AGENT_ID" } },
      ]),
    ],
  });
  const normalized = normalizeRuntimePresence(
    extractAllowlistedSignals(payload, {
      scenario: "subagent-parallel",
      receivedAt,
    }),
  );
  const serialized = JSON.stringify(normalized);

  for (const prohibitedValue of [
    "PRIVATE_PROMPT",
    "PRIVATE_RESPONSE",
    "PRIVATE_REASONING",
    "PRIVATE_TRANSCRIPT",
    "PRIVATE_TOOL_INPUT",
    "PRIVATE_TOOL_OUTPUT",
    "PRIVATE_THREAD_ID",
    "PRIVATE_PARENT_THREAD_ID",
    "PRIVATE_AGENT_ID",
    "PRIVATE_NICKNAME",
    "PRIVATE_EXEMPLAR",
    "PRIVATE_SPAWN_EXEMPLAR",
    "PRIVATE_SCOPE_DATA",
    "/private/path",
  ]) {
    assert.equal(serialized.includes(prohibitedValue), false);
  }
});

test("uses finite allowlists for scenarios, Skills, and custom-agent roles", () => {
  assert.deepEqual(SCENARIO_IDS, [
    "nested-chain-depth-2",
    "nested-chain-depth-3",
    "nested-branch",
    "nested-diamond",
    "subagent-config-dormant",
    "subagent-single-skill",
    "subagent-nested-chain",
    "subagent-parallel",
  ]);
  assert.equal(SYNTHETIC_SKILL_NAMES.length, 22);
  assert.equal(SYNTHETIC_AGENT_ROLES.length, 5);
  assert.equal(isScenarioId("subagent-parallel"), true);
  assert.equal(isScenarioId("user-scenario"), false);
  assert.equal(
    isSyntheticSkillName("renma-topology-diamond-shared-20260806"),
    true,
  );
  assert.equal(isSyntheticSkillName("user-skill"), false);
  assert.equal(
    isSyntheticAgentRole("renma_topology_chain_worker_20260806"),
    true,
  );
  assert.equal(isSyntheticAgentRole("worker"), false);

  const allowlistedPayload = metricPayload({
    skillPoints: [skillPoint("renma-topology-child-single-20260806", "ok")],
    spawnPoints: [spawnPoint("renma_topology_worker_20260806")],
  });
  assert.deepEqual(
    extractAllowlistedSignals(allowlistedPayload, {
      scenario: "user-scenario",
      receivedAt,
    }),
    [],
  );
});
