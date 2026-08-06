import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { request, type ClientRequest } from "node:http";
import test from "node:test";

import {
  createCodexSkillEvidenceCollector,
  type CodexSkillEvidenceCollector,
  type CodexSkillEvidenceDiagnosticsSnapshot,
} from "../src/index.js";

const allowedAlpha = "allowed-alpha";
const allowedBeta = "allowed-beta";

interface HttpResult {
  statusCode: number | undefined;
  body: string;
}

function diagnostics(
  overrides: Partial<CodexSkillEvidenceDiagnosticsSnapshot> = {},
): CodexSkillEvidenceDiagnosticsSnapshot {
  return {
    schemaVersion: 1,
    otlpMetricsRequestsReceived: 0,
    successfullyDecodedRequests: 0,
    decodeFailures: 0,
    requestReadFailures: 0,
    requestBodyTooLargeFailures: 0,
    jsonParseFailures: 0,
    otlpValidationFailures: 0,
    resourceMetricsEntriesInspected: 0,
    scopeMetricsEntriesInspected: 0,
    metricsInspected: 0,
    metricDataPointsInspected: 0,
    targetMetricsObserved: 0,
    targetDataPointsObserved: 0,
    targetDataPointsWithStatusOk: 0,
    targetDataPointsWithStatusError: 0,
    targetDataPointsWithOtherOrMissingStatus: 0,
    positiveTargetDataPoints: 0,
    zeroTargetDataPoints: 0,
    negativeTargetDataPoints: 0,
    targetDataPointsWithNoRecordedValue: 0,
    targetDataPointsWithUnsupportedOrMissingValue: 0,
    acceptedAllowlistedSkillDataPoints: 0,
    unknownOrMissingSkillLabelDataPoints: 0,
    counterSaturationObserved: false,
    ...overrides,
  };
}

function sendRequest(
  endpoint: string,
  body: string,
  options: { method?: string; path?: string } = {},
): Promise<HttpResult> {
  const target = new URL(endpoint);
  if (options.path) {
    target.pathname = options.path;
  }
  return new Promise((resolve, reject) => {
    const clientRequest = request(
      target,
      {
        method: options.method ?? "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          connection: "close",
        },
      },
      (response) => {
        let responseBody = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          responseBody += chunk;
        });
        response.once("error", reject);
        response.once("end", () => {
          resolve({ statusCode: response.statusCode, body: responseBody });
        });
      },
    );
    clientRequest.once("error", reject);
    clientRequest.end(body);
  });
}

function attribute(key: string, value: unknown): unknown {
  return { key, value };
}

function stringAttribute(key: string, value: string): unknown {
  return attribute(key, { stringValue: value });
}

function point(
  attributes: unknown[],
  valueAndFlags: Record<string, unknown> = { asInt: "47" },
): unknown {
  return {
    attributes,
    ...valueAndFlags,
    exemplars: [{ value: "PRIVATE_EXEMPLAR" }],
    timestampUnixNano: "PRIVATE_TIMESTAMP",
    agentId: "PRIVATE_AGENT_ID",
    threadId: "PRIVATE_THREAD_ID",
    parentThreadId: "PRIVATE_PARENT_THREAD_ID",
    sessionId: "PRIVATE_SESSION_ID",
  };
}

function successfulPoint(
  skill: string,
  status = "ok",
  extraAttributes: unknown[] = [],
): unknown {
  return point([
    stringAttribute("skill", skill),
    stringAttribute("status", status),
    ...extraAttributes,
  ]);
}

function metric(name: string, dataPoints: unknown[]): unknown {
  return { name, sum: { dataPoints } };
}

function payload(metrics: unknown[]): string {
  return JSON.stringify({
    resourceMetrics: [
      {
        resource: {
          attributes: [
            stringAttribute("user.prompt", "PRIVATE_PROMPT"),
            stringAttribute("repository.path", "/PRIVATE/REPOSITORY/PATH"),
            stringAttribute("credential", "PRIVATE_CREDENTIAL"),
          ],
        },
        scopeMetrics: [
          {
            scope: {
              name: "PRIVATE_SCOPE",
              version: "PRIVATE_SCOPE_VERSION",
            },
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
    taskResult: "PRIVATE_TASK_RESULT",
  });
}

async function closeQuietly(
  collector: CodexSkillEvidenceCollector | undefined,
): Promise<void> {
  await collector?.closeAndSnapshot();
}

test("rejects empty, missing, malformed, and unbounded allowlists before use", async () => {
  const invalidOptions: unknown[] = [
    undefined,
    null,
    {},
    { allowedSkills: [] },
    { allowedSkills: "not-an-array" },
    { allowedSkills: [17] },
    { allowedSkills: [""] },
    { allowedSkills: ["contains\u0000control"] },
    { allowedSkills: ["contains\u009fcontrol"] },
    { allowedSkills: ["\ud800"] },
    {
      allowedSkills: Array.from(
        { length: 129 },
        (_, index) => `skill-${index}`,
      ),
    },
  ];

  for (const invalidOption of invalidOptions) {
    await assert.rejects(
      (
        createCodexSkillEvidenceCollector as (
          options: unknown,
        ) => Promise<unknown>
      )(invalidOption),
      (error: unknown) => {
        assert.equal(error instanceof TypeError, true);
        assert.equal(
          (error as Error).message,
          "Invalid Codex Skill evidence allowlist",
        );
        return true;
      },
    );
  }
});

test("keeps allowlist validation errors structural and content-free", async () => {
  const privateSentinel = "PRIVATE_INVALID_ALLOWLIST_2C83F1";
  const invalidName = `${privateSentinel}\u0000`;
  const privateForms = [
    privateSentinel,
    invalidName,
    Buffer.from(invalidName, "utf8").toString("base64"),
    Buffer.from(invalidName, "utf8").toString("hex"),
    createHash("sha256").update(invalidName).digest("hex"),
  ];
  const maliciousOptions = new Proxy(
    {},
    {
      get: () => {
        throw new Error(privateSentinel);
      },
    },
  );

  for (const invalidOptions of [
    { allowedSkills: [invalidName] },
    maliciousOptions,
  ]) {
    try {
      await (
        createCodexSkillEvidenceCollector as (
          options: unknown,
        ) => Promise<unknown>
      )(invalidOptions);
      assert.fail("Expected invalid allowlist rejection");
    } catch (error) {
      const serializedError = JSON.stringify({
        name: (error as Error).name,
        message: (error as Error).message,
      });
      assert.equal(
        (error as Error).message,
        "Invalid Codex Skill evidence allowlist",
      );
      for (const privateForm of privateForms) {
        assert.equal(serializedError.includes(privateForm), false);
      }
    }
  }
});

test("enforces the finite name limits and deduplicates exact caller entries", async () => {
  const maximumAsciiName = "a".repeat(256);
  const maximumUtf8Name = "😀".repeat(256);
  const maximumEntries = Array.from(
    { length: 128 },
    (_, index) => `allowed-${String(index).padStart(3, "0")}`,
  );
  let collector: CodexSkillEvidenceCollector | undefined;

  try {
    collector = await createCodexSkillEvidenceCollector({
      allowedSkills: [
        maximumAsciiName,
        maximumUtf8Name,
        allowedAlpha,
        allowedAlpha,
      ],
    });
    assert.equal(new URL(collector.endpoint).hostname, "127.0.0.1");
  } finally {
    await closeQuietly(collector);
  }

  collector = undefined;
  try {
    collector = await createCodexSkillEvidenceCollector({
      allowedSkills: maximumEntries,
    });
  } finally {
    await closeQuietly(collector);
  }

  await assert.rejects(
    createCodexSkillEvidenceCollector({
      allowedSkills: ["a".repeat(257)],
    }),
    /Invalid Codex Skill evidence allowlist/,
  );
  await assert.rejects(
    createCodexSkillEvidenceCollector({
      allowedSkills: ["😀".repeat(257)],
    }),
    /Invalid Codex Skill evidence allowlist/,
  );
});

test("copies the validated allowlist instead of retaining the caller array", async () => {
  const callerAllowlist = [allowedAlpha];
  const collector = await createCodexSkillEvidenceCollector({
    allowedSkills: callerAllowlist,
  });
  callerAllowlist[0] = allowedBeta;

  const result = await sendRequest(
    collector.endpoint,
    payload([
      metric("codex.skill.injected", [
        successfulPoint(allowedAlpha),
        successfulPoint(allowedBeta),
      ]),
    ]),
  );
  const snapshot = await collector.closeAndSnapshot();

  assert.equal(result.statusCode, 200);
  assert.deepEqual(snapshot.injectedSkills, [allowedAlpha]);
  assert.equal(snapshot.unrecognizedSkillObserved, true);
});

test("accepts only an exact successful Codex Skill injection", async () => {
  const collector = await createCodexSkillEvidenceCollector({
    allowedSkills: [allowedAlpha],
  });
  const result = await sendRequest(
    collector.endpoint,
    payload([metric("codex.skill.injected", [successfulPoint(allowedAlpha)])]),
  );
  const snapshot = await collector.closeAndSnapshot();

  assert.equal(result.statusCode, 200);
  assert.equal(result.body, "{}\n");
  assert.deepEqual(snapshot, {
    schemaVersion: 1,
    provider: "codex",
    signal: "skill-injected",
    observationScope: "collector-lifetime",
    injectedSkills: [allowedAlpha],
    unrecognizedSkillObserved: false,
  });
});

test("starts with a separate immutable zero diagnostics snapshot", async () => {
  const collector = await createCodexSkillEvidenceCollector({
    allowedSkills: [allowedAlpha],
  });
  const first = collector.diagnosticsSnapshot();
  const second = collector.diagnosticsSnapshot();

  assert.deepEqual(first, diagnostics());
  assert.equal(Object.isFrozen(first), true);
  assert.notStrictEqual(first, second);
  for (const [key, value] of Object.entries(first)) {
    if (key === "counterSaturationObserved") {
      assert.equal(typeof value, "boolean");
    } else {
      assert.equal(Number.isInteger(value), true);
      assert.equal((value as number) >= 0, true);
      assert.equal((value as number) <= 0xffff_ffff, true);
    }
  }
  assert.throws(() => {
    (
      first as { otlpMetricsRequestsReceived: number }
    ).otlpMetricsRequestsReceived = 99;
  }, TypeError);
  assert.deepEqual(collector.diagnosticsSnapshot(), diagnostics());
  await collector.closeAndSnapshot();
});

test("diagnoses a valid empty OTLP request independently from evidence", async () => {
  const collector = await createCodexSkillEvidenceCollector({
    allowedSkills: [allowedAlpha],
  });
  const result = await sendRequest(
    collector.endpoint,
    JSON.stringify({ resourceMetrics: [] }),
  );
  const evidence = await collector.closeAndSnapshot();

  assert.equal(result.statusCode, 200);
  assert.deepEqual(evidence.injectedSkills, []);
  assert.deepEqual(
    collector.diagnosticsSnapshot(),
    diagnostics({
      otlpMetricsRequestsReceived: 1,
      successfullyDecodedRequests: 1,
    }),
  );
});

test("counts malformed requests before decoding without retaining input", async () => {
  const privateMalformedInput = "PRIVATE_MALFORMED_DIAGNOSTIC_INPUT_4D60";
  const collector = await createCodexSkillEvidenceCollector({
    allowedSkills: [allowedAlpha],
  });
  const result = await sendRequest(collector.endpoint, privateMalformedInput);
  const evidence = await collector.closeAndSnapshot();
  const observedDiagnostics = collector.diagnosticsSnapshot();

  assert.equal(result.statusCode, 400);
  assert.deepEqual(
    observedDiagnostics,
    diagnostics({
      otlpMetricsRequestsReceived: 1,
      decodeFailures: 1,
      jsonParseFailures: 1,
    }),
  );
  assert.equal(
    JSON.stringify({ evidence, observedDiagnostics }).includes(
      privateMalformedInput,
    ),
    false,
  );
});

test("counts non-target metric datapoints without exposing their names or attributes", async () => {
  const privateMetricName = "PRIVATE_OTHER_METRIC_9C6F";
  const privateAttributeValue = "PRIVATE_ATTRIBUTE_VALUE_C7D2";
  const collector = await createCodexSkillEvidenceCollector({
    allowedSkills: [allowedAlpha],
  });
  const result = await sendRequest(
    collector.endpoint,
    payload([
      metric(privateMetricName, [
        point([stringAttribute("PRIVATE_KEY", privateAttributeValue)]),
        point([]),
      ]),
    ]),
  );
  const evidence = await collector.closeAndSnapshot();
  const observedDiagnostics = collector.diagnosticsSnapshot();

  assert.equal(result.statusCode, 200);
  assert.deepEqual(
    observedDiagnostics,
    diagnostics({
      otlpMetricsRequestsReceived: 1,
      successfullyDecodedRequests: 1,
      resourceMetricsEntriesInspected: 1,
      scopeMetricsEntriesInspected: 1,
      metricsInspected: 1,
      metricDataPointsInspected: 2,
    }),
  );
  const serialized = JSON.stringify({ evidence, observedDiagnostics });
  assert.equal(serialized.includes(privateMetricName), false);
  assert.equal(serialized.includes(privateAttributeValue), false);
});

test("diagnoses target status, sign, acceptance, and bounded Skill-label categories", async () => {
  const privateUnknownSkill = "PRIVATE_UNKNOWN_DIAGNOSTIC_SKILL_D96A";
  const collector = await createCodexSkillEvidenceCollector({
    allowedSkills: [allowedAlpha],
  });
  const result = await sendRequest(
    collector.endpoint,
    payload([
      metric("codex.skill.injected", [
        successfulPoint(allowedAlpha),
        successfulPoint(allowedAlpha, "error"),
        point(
          [
            stringAttribute("skill", allowedAlpha),
            stringAttribute("status", "ok"),
          ],
          { asInt: "0" },
        ),
        point(
          [
            stringAttribute("skill", allowedAlpha),
            stringAttribute("status", "ok"),
          ],
          { asDouble: -0.5 },
        ),
        successfulPoint(allowedAlpha, "PRIVATE_UNEXPECTED_STATUS"),
        point([stringAttribute("skill", allowedAlpha)]),
        successfulPoint(privateUnknownSkill),
        point([stringAttribute("status", "ok")]),
      ]),
    ]),
  );
  const evidence = await collector.closeAndSnapshot();
  const observedDiagnostics = collector.diagnosticsSnapshot();

  assert.equal(result.statusCode, 200);
  assert.deepEqual(evidence.injectedSkills, [allowedAlpha]);
  assert.equal(evidence.unrecognizedSkillObserved, true);
  assert.deepEqual(
    observedDiagnostics,
    diagnostics({
      otlpMetricsRequestsReceived: 1,
      successfullyDecodedRequests: 1,
      resourceMetricsEntriesInspected: 1,
      scopeMetricsEntriesInspected: 1,
      metricsInspected: 1,
      metricDataPointsInspected: 8,
      targetMetricsObserved: 1,
      targetDataPointsObserved: 8,
      targetDataPointsWithStatusOk: 5,
      targetDataPointsWithStatusError: 1,
      targetDataPointsWithOtherOrMissingStatus: 2,
      positiveTargetDataPoints: 6,
      zeroTargetDataPoints: 1,
      negativeTargetDataPoints: 1,
      acceptedAllowlistedSkillDataPoints: 1,
      unknownOrMissingSkillLabelDataPoints: 2,
    }),
  );
  const serialized = JSON.stringify({ evidence, observedDiagnostics });
  assert.equal(serialized.includes(privateUnknownSkill), false);
  assert.equal(serialized.includes("PRIVATE_UNEXPECTED_STATUS"), false);
});

test("aggregates diagnostics monotonically across requests and returns defensive copies", async () => {
  const collector = await createCodexSkillEvidenceCollector({
    allowedSkills: [allowedAlpha],
  });
  assert.equal(
    (
      await sendRequest(
        collector.endpoint,
        payload([metric("PRIVATE_OTHER_METRIC", [point([])])]),
      )
    ).statusCode,
    200,
  );
  const afterFirst = collector.diagnosticsSnapshot();
  assert.equal(
    (
      await sendRequest(
        collector.endpoint,
        payload([
          metric("codex.skill.injected", [successfulPoint(allowedAlpha)]),
        ]),
      )
    ).statusCode,
    200,
  );
  await collector.closeAndSnapshot();
  const afterSecond = collector.diagnosticsSnapshot();

  assert.deepEqual(
    afterFirst,
    diagnostics({
      otlpMetricsRequestsReceived: 1,
      successfullyDecodedRequests: 1,
      resourceMetricsEntriesInspected: 1,
      scopeMetricsEntriesInspected: 1,
      metricsInspected: 1,
      metricDataPointsInspected: 1,
    }),
  );
  assert.deepEqual(
    afterSecond,
    diagnostics({
      otlpMetricsRequestsReceived: 2,
      successfullyDecodedRequests: 2,
      resourceMetricsEntriesInspected: 2,
      scopeMetricsEntriesInspected: 2,
      metricsInspected: 2,
      metricDataPointsInspected: 2,
      targetMetricsObserved: 1,
      targetDataPointsObserved: 1,
      targetDataPointsWithStatusOk: 1,
      positiveTargetDataPoints: 1,
      acceptedAllowlistedSkillDataPoints: 1,
    }),
  );
  assert.equal(afterFirst.otlpMetricsRequestsReceived, 1);
  assert.notStrictEqual(afterFirst, afterSecond);
});

test("accepts positive OTLP integer-string and finite double counters", async () => {
  const collector = await createCodexSkillEvidenceCollector({
    allowedSkills: [allowedAlpha, allowedBeta],
  });
  const result = await sendRequest(
    collector.endpoint,
    payload([
      metric("codex.skill.injected", [
        point(
          [
            stringAttribute("skill", allowedAlpha),
            stringAttribute("status", "ok"),
          ],
          { asInt: "9223372036854775807" },
        ),
        point(
          [
            stringAttribute("skill", allowedBeta),
            stringAttribute("status", "ok"),
          ],
          { asDouble: Number.MIN_VALUE },
        ),
      ]),
    ]),
  );
  const snapshot = await collector.closeAndSnapshot();

  assert.equal(result.statusCode, 200);
  assert.deepEqual(snapshot.injectedSkills, [allowedAlpha, allowedBeta]);
  assert.equal(snapshot.unrecognizedSkillObserved, false);
});

test("rejects missing, conflicting, and malformed counter values as evidence", async (t) => {
  const malformedValues: Array<{
    name: string;
    valueAndFlags: Record<string, unknown>;
    status?: string;
  }> = [
    { name: "missing value", valueAndFlags: {} },
    {
      name: "missing value with non-ok status",
      valueAndFlags: {},
      status: "error",
    },
    {
      name: "both integer and double values",
      valueAndFlags: { asInt: "1", asDouble: 1 },
    },
    { name: "non-decimal integer", valueAndFlags: { asInt: "1e3" } },
    { name: "numeric integer", valueAndFlags: { asInt: 1 } },
    {
      name: "out-of-range integer",
      valueAndFlags: { asInt: "9223372036854775808" },
    },
    { name: "non-finite double string", valueAndFlags: { asDouble: "NaN" } },
    { name: "non-numeric double", valueAndFlags: { asDouble: null } },
    {
      name: "malformed no-recorded-value flag",
      valueAndFlags: { flags: "1", asInt: "47" },
    },
  ];

  for (const malformedValue of malformedValues) {
    await t.test(malformedValue.name, async () => {
      const collector = await createCodexSkillEvidenceCollector({
        allowedSkills: [allowedAlpha],
      });
      const result = await sendRequest(
        collector.endpoint,
        payload([
          metric("codex.skill.injected", [
            point(
              [
                stringAttribute("skill", allowedAlpha),
                stringAttribute("status", malformedValue.status ?? "ok"),
              ],
              malformedValue.valueAndFlags,
            ),
          ]),
        ]),
      );
      const snapshot = await collector.closeAndSnapshot();

      assert.equal(result.statusCode, 200);
      assert.equal(result.body, "{}\n");
      assert.deepEqual(snapshot.injectedSkills, []);
      assert.equal(snapshot.unrecognizedSkillObserved, false);
      assert.equal(
        collector.diagnosticsSnapshot()
          .targetDataPointsWithUnsupportedOrMissingValue,
        1,
      );
    });
  }
});

test("rejects a JSON number that parses to a non-finite double", async () => {
  const collector = await createCodexSkillEvidenceCollector({
    allowedSkills: [allowedAlpha],
  });
  const finiteMarker = 9123456789;
  const finiteBody = payload([
    metric("codex.skill.injected", [
      point(
        [
          stringAttribute("skill", allowedAlpha),
          stringAttribute("status", "ok"),
        ],
        { asDouble: finiteMarker },
      ),
    ]),
  ]);
  const result = await sendRequest(
    collector.endpoint,
    finiteBody.replace(String(finiteMarker), "1e400"),
  );
  const snapshot = await collector.closeAndSnapshot();

  assert.equal(result.statusCode, 200);
  assert.deepEqual(snapshot.injectedSkills, []);
  assert.equal(snapshot.unrecognizedSkillObserved, false);
});

test("ignores zero and negative counters for allowlisted and unknown labels", async () => {
  const unknownSkill = "PRIVATE_NON_POSITIVE_UNKNOWN";
  const valueCases: Array<Record<string, unknown>> = [
    { asInt: "0" },
    { asInt: "-1" },
    { asDouble: 0 },
    { asDouble: -0.25 },
  ];
  const collector = await createCodexSkillEvidenceCollector({
    allowedSkills: [allowedAlpha],
  });
  const dataPoints = valueCases.flatMap((valueAndFlags) => [
    point(
      [stringAttribute("skill", allowedAlpha), stringAttribute("status", "ok")],
      valueAndFlags,
    ),
    point(
      [stringAttribute("skill", unknownSkill), stringAttribute("status", "ok")],
      valueAndFlags,
    ),
  ]);
  const result = await sendRequest(
    collector.endpoint,
    payload([metric("codex.skill.injected", dataPoints)]),
  );
  const snapshot = await collector.closeAndSnapshot();

  assert.equal(result.statusCode, 200);
  assert.deepEqual(snapshot.injectedSkills, []);
  assert.equal(snapshot.unrecognizedSkillObserved, false);
  assert.equal(JSON.stringify(snapshot).includes(unknownSkill), false);
});

test("ignores valid NO_RECORDED_VALUE points before reading a value", async () => {
  const unknownSkill = "PRIVATE_NO_RECORDED_UNKNOWN";
  const collector = await createCodexSkillEvidenceCollector({
    allowedSkills: [allowedAlpha],
  });
  const result = await sendRequest(
    collector.endpoint,
    payload([
      metric("codex.skill.injected", [
        point(
          [
            stringAttribute("skill", allowedAlpha),
            stringAttribute("status", "ok"),
          ],
          { flags: 1, asInt: "47" },
        ),
        point(
          [
            stringAttribute("skill", unknownSkill),
            stringAttribute("status", "ok"),
          ],
          { flags: 3 },
        ),
      ]),
    ]),
  );
  const snapshot = await collector.closeAndSnapshot();

  assert.equal(result.statusCode, 200);
  assert.deepEqual(snapshot.injectedSkills, []);
  assert.equal(snapshot.unrecognizedSkillObserved, false);
  assert.equal(
    collector.diagnosticsSnapshot().targetDataPointsWithNoRecordedValue,
    2,
  );
  assert.equal(JSON.stringify(snapshot).includes(unknownSkill), false);
});

test("ignores non-ok statuses and non-exact metric names", async () => {
  const collector = await createCodexSkillEvidenceCollector({
    allowedSkills: [allowedAlpha],
  });
  const result = await sendRequest(
    collector.endpoint,
    payload([
      metric("codex.skill.injected.suffix", [successfulPoint(allowedAlpha)]),
      metric("skill.injected", [successfulPoint(allowedAlpha)]),
      metric("codex.skill.injected", [
        successfulPoint(allowedAlpha, "error"),
        successfulPoint(allowedAlpha, "OK"),
        successfulPoint(allowedAlpha, ""),
        successfulPoint("PRIVATE_UNKNOWN_NON_OK", "error"),
      ]),
    ]),
  );
  const snapshot = await collector.closeAndSnapshot();

  assert.equal(result.statusCode, 200);
  assert.deepEqual(snapshot.injectedSkills, []);
  assert.equal(snapshot.unrecognizedSkillObserved, false);
});

test("classifies an unknown successful Skill without retaining or transforming it", async () => {
  const unknownSkill = "PRIVATE_UNKNOWN_SKILL_7B9E31";
  const collector = await createCodexSkillEvidenceCollector({
    allowedSkills: [allowedAlpha],
  });
  const result = await sendRequest(
    collector.endpoint,
    payload([metric("codex.skill.injected", [successfulPoint(unknownSkill)])]),
  );
  const snapshot = await collector.closeAndSnapshot();
  const serializedOutputs = JSON.stringify({ snapshot, response: result });
  const prohibitedForms = [
    unknownSkill,
    Buffer.from(unknownSkill, "utf8").toString("base64"),
    Buffer.from(unknownSkill, "utf8").toString("hex"),
    createHash("sha256").update(unknownSkill).digest("hex"),
  ];

  assert.equal(result.statusCode, 200);
  assert.deepEqual(snapshot.injectedSkills, []);
  assert.equal(snapshot.unrecognizedSkillObserved, true);
  for (const prohibited of prohibitedForms) {
    assert.equal(serializedOutputs.includes(prohibited), false);
  }
});

test("rejects duplicate and non-string evidence attributes", async (t) => {
  const malformedPoints: Array<{ name: string; value: unknown }> = [
    {
      name: "duplicate skill",
      value: point([
        stringAttribute("skill", allowedAlpha),
        stringAttribute("skill", "PRIVATE_DUPLICATE_SKILL"),
        stringAttribute("status", "ok"),
      ]),
    },
    {
      name: "non-string skill",
      value: point([
        attribute("skill", { intValue: "5" }),
        stringAttribute("status", "ok"),
      ]),
    },
    {
      name: "duplicate status",
      value: point([
        stringAttribute("skill", allowedAlpha),
        stringAttribute("status", "ok"),
        stringAttribute("status", "PRIVATE_DUPLICATE_STATUS"),
      ]),
    },
    {
      name: "non-string status",
      value: point([
        stringAttribute("skill", allowedAlpha),
        attribute("status", { boolValue: true }),
      ]),
    },
  ];

  for (const malformedPoint of malformedPoints) {
    await t.test(malformedPoint.name, async () => {
      const collector = await createCodexSkillEvidenceCollector({
        allowedSkills: [allowedAlpha],
      });
      const result = await sendRequest(
        collector.endpoint,
        payload([metric("codex.skill.injected", [malformedPoint.value])]),
      );
      const snapshot = await collector.closeAndSnapshot();
      assert.equal(result.statusCode, 400);
      assert.equal(result.body, "");
      assert.deepEqual(snapshot.injectedSkills, []);
      assert.equal(snapshot.unrecognizedSkillObserved, false);
      assert.equal(JSON.stringify(snapshot).includes("PRIVATE_"), false);
    });
  }
});

test("sorts and deduplicates multiple allowed cumulative exports", async () => {
  const collector = await createCodexSkillEvidenceCollector({
    allowedSkills: [allowedBeta, allowedAlpha],
  });
  const cumulativePayload = payload([
    metric("codex.skill.injected", [
      successfulPoint(allowedBeta),
      successfulPoint(allowedAlpha),
      successfulPoint(allowedBeta),
    ]),
  ]);

  assert.equal(
    (await sendRequest(collector.endpoint, cumulativePayload)).statusCode,
    200,
  );
  assert.equal(
    (await sendRequest(collector.endpoint, cumulativePayload)).statusCode,
    200,
  );
  assert.deepEqual((await collector.closeAndSnapshot()).injectedSkills, [
    allowedAlpha,
    allowedBeta,
  ]);
});

test("normalizes mixed accepted and rejected observations without widening evidence", async () => {
  const unknownSkill = "PRIVATE_MIXED_UNKNOWN_SKILL";
  const collector = await createCodexSkillEvidenceCollector({
    allowedSkills: [allowedAlpha, allowedBeta],
  });
  const result = await sendRequest(
    collector.endpoint,
    payload([
      metric("codex.skill.injected", [
        successfulPoint(allowedAlpha),
        successfulPoint(allowedBeta, "error"),
        successfulPoint(unknownSkill),
        point(
          [
            stringAttribute("skill", allowedBeta),
            stringAttribute("status", "ok"),
          ],
          { asInt: "0" },
        ),
      ]),
      metric("codex.skill.executed", [successfulPoint(allowedBeta)]),
    ]),
  );
  const snapshot = await collector.closeAndSnapshot();

  assert.equal(result.statusCode, 200);
  assert.deepEqual(snapshot.injectedSkills, [allowedAlpha]);
  assert.equal(snapshot.unrecognizedSkillObserved, true);
  assert.equal(
    JSON.stringify({ result, snapshot }).includes(unknownSkill),
    false,
  );
});

test("produces the same presence snapshot for different fixture orderings", async () => {
  const forwardCollector = await createCodexSkillEvidenceCollector({
    allowedSkills: [allowedBeta, allowedAlpha],
  });
  const reverseCollector = await createCodexSkillEvidenceCollector({
    allowedSkills: [allowedAlpha, allowedBeta],
  });
  const forwardPoints = [
    successfulPoint(allowedBeta),
    successfulPoint(allowedAlpha),
    successfulPoint(allowedBeta),
  ];

  const [forwardResult, reverseResult] = await Promise.all([
    sendRequest(
      forwardCollector.endpoint,
      payload([metric("codex.skill.injected", forwardPoints)]),
    ),
    sendRequest(
      reverseCollector.endpoint,
      payload([metric("codex.skill.injected", [...forwardPoints].reverse())]),
    ),
  ]);
  const [forwardSnapshot, reverseSnapshot] = await Promise.all([
    forwardCollector.closeAndSnapshot(),
    reverseCollector.closeAndSnapshot(),
  ]);

  assert.equal(forwardResult.statusCode, 200);
  assert.equal(reverseResult.statusCode, 200);
  assert.deepEqual(forwardSnapshot, reverseSnapshot);
  assert.deepEqual(forwardSnapshot.injectedSkills, [allowedAlpha, allowedBeta]);
  assert.equal("counts" in forwardSnapshot, false);
});

test("rejects malformed JSON and malformed OTLP envelopes", async () => {
  const malformedBodies = [
    "not-json",
    JSON.stringify(null),
    JSON.stringify({}),
    JSON.stringify({ resourceMetrics: {} }),
    JSON.stringify({ resourceMetrics: [{}] }),
    JSON.stringify({ resourceMetrics: [{ scopeMetrics: [{}] }] }),
    payload([{}]),
    payload([{ name: "codex.skill.injected" }]),
    payload([{ name: "codex.skill.injected", sum: "malformed" }]),
    payload([
      { name: "codex.skill.injected", sum: { dataPoints: "malformed" } },
    ]),
  ];

  for (const body of malformedBodies) {
    const collector = await createCodexSkillEvidenceCollector({
      allowedSkills: [allowedAlpha],
    });
    const result = await sendRequest(collector.endpoint, body);
    const snapshot = await collector.closeAndSnapshot();
    assert.equal(result.statusCode, 400);
    assert.equal(result.body, "");
    assert.deepEqual(snapshot.injectedSkills, []);
  }
});

test("atomically rejects an unsupported-value request without partial snapshot mutation", async () => {
  const collector = await createCodexSkillEvidenceCollector({
    allowedSkills: [allowedAlpha, allowedBeta],
  });
  const accepted = await sendRequest(
    collector.endpoint,
    payload([metric("codex.skill.injected", [successfulPoint(allowedAlpha)])]),
  );
  const rejected = await sendRequest(
    collector.endpoint,
    payload([
      metric("codex.skill.injected", [
        successfulPoint(allowedBeta),
        point(
          [
            stringAttribute("skill", "PRIVATE_PARTIAL_SKILL"),
            stringAttribute("status", "ok"),
          ],
          {},
        ),
      ]),
    ]),
  );
  const snapshot = await collector.closeAndSnapshot();

  assert.equal(accepted.statusCode, 200);
  assert.equal(rejected.statusCode, 200);
  assert.deepEqual(snapshot.injectedSkills, [allowedAlpha]);
  assert.equal(snapshot.unrecognizedSkillObserved, false);
  assert.equal(
    JSON.stringify(snapshot).includes("PRIVATE_PARTIAL_SKILL"),
    false,
  );
});

test("atomically rejects public evidence from a request with an unsupported value", async () => {
  const collector = await createCodexSkillEvidenceCollector({
    allowedSkills: [allowedAlpha, allowedBeta],
  });
  const result = await sendRequest(
    collector.endpoint,
    payload([
      metric("codex.skill.injected", [
        successfulPoint(allowedAlpha),
        point(
          [
            stringAttribute("skill", allowedBeta),
            stringAttribute("status", "ok"),
          ],
          {},
        ),
      ]),
    ]),
  );
  const snapshot = await collector.closeAndSnapshot();

  assert.equal(result.statusCode, 200);
  assert.deepEqual(snapshot.injectedSkills, []);
  assert.equal(snapshot.unrecognizedSkillObserved, false);
  assert.equal(
    collector.diagnosticsSnapshot()
      .targetDataPointsWithUnsupportedOrMissingValue,
    1,
  );
});

test("enforces the fixed two-MiB request limit", async () => {
  const collector = await createCodexSkillEvidenceCollector({
    allowedSkills: [allowedAlpha],
  });
  const result = await sendRequest(
    collector.endpoint,
    "x".repeat(2 * 1024 * 1024 + 1),
  );
  const snapshot = await collector.closeAndSnapshot();

  assert.equal(result.statusCode, 413);
  assert.equal(result.body, "");
  assert.deepEqual(snapshot.injectedSkills, []);
});

test("drains an accepted in-flight request before snapshotting", async () => {
  const collector = await createCodexSkillEvidenceCollector({
    allowedSkills: [allowedAlpha],
  });
  const body = payload([
    metric("codex.skill.injected", [successfulPoint(allowedAlpha)]),
  ]);
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
    const snapshotPromise = collector.closeAndSnapshot();
    clientRequest.end(body);
    await responseFinished;
    assert.deepEqual((await snapshotPromise).injectedSkills, [allowedAlpha]);
  } finally {
    clientRequest?.destroy();
    await collector.closeAndSnapshot();
  }
});

test("is loopback-only and rejects every non-metrics route", async () => {
  const collector = await createCodexSkillEvidenceCollector({
    allowedSkills: [allowedAlpha],
  });
  const endpoint = new URL(collector.endpoint);

  assert.equal(endpoint.protocol, "http:");
  assert.equal(endpoint.hostname, "127.0.0.1");
  assert.equal(endpoint.pathname, "/v1/metrics");
  assert.equal(
    (await sendRequest(collector.endpoint, "", { method: "GET" })).statusCode,
    404,
  );
  assert.equal(
    (await sendRequest(collector.endpoint, "{}", { path: "/other" }))
      .statusCode,
    404,
  );
  await collector.closeAndSnapshot();
});

test("returns idempotent immutable defensive snapshots", async () => {
  const collector = await createCodexSkillEvidenceCollector({
    allowedSkills: [allowedAlpha],
  });
  await sendRequest(
    collector.endpoint,
    payload([metric("codex.skill.injected", [successfulPoint(allowedAlpha)])]),
  );

  const [first, second] = await Promise.all([
    collector.closeAndSnapshot(),
    collector.closeAndSnapshot(),
  ]);
  assert.deepEqual(first, second);
  assert.notStrictEqual(first, second);
  assert.notStrictEqual(first.injectedSkills, second.injectedSkills);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.injectedSkills), true);
  assert.throws(() => {
    (first.injectedSkills as string[]).push("CALLER_MUTATION");
  }, TypeError);
  assert.deepEqual((await collector.closeAndSnapshot()).injectedSkills, [
    allowedAlpha,
  ]);
});

test("serialized snapshots exclude content, paths, credentials, IDs, values, hashes, and encodings", async () => {
  const unknownSkill = "PRIVATE_UNKNOWN_SKILL_6F42D8";
  const privateValues = [
    "PRIVATE_PROMPT",
    "PRIVATE_RESPONSE",
    "PRIVATE_REASONING",
    "PRIVATE_TRANSCRIPT",
    "PRIVATE_TOOL_INPUT",
    "PRIVATE_TOOL_OUTPUT",
    "PRIVATE_TASK_RESULT",
    "PRIVATE_EXEMPLAR",
    "PRIVATE_TIMESTAMP",
    "PRIVATE_AGENT_ID",
    "PRIVATE_THREAD_ID",
    "PRIVATE_PARENT_THREAD_ID",
    "PRIVATE_SESSION_ID",
    "PRIVATE_SCOPE",
    "PRIVATE_SCOPE_VERSION",
    "PRIVATE_CREDENTIAL",
    "/PRIVATE/REPOSITORY/PATH",
    "PRIVATE_NICKNAME",
    unknownSkill,
    Buffer.from(unknownSkill, "utf8").toString("base64"),
    Buffer.from(unknownSkill, "utf8").toString("hex"),
    createHash("sha256").update(unknownSkill).digest("hex"),
  ];
  const collector = await createCodexSkillEvidenceCollector({
    allowedSkills: [allowedAlpha],
  });
  const result = await sendRequest(
    collector.endpoint,
    payload([
      metric("codex.skill.injected", [
        successfulPoint(unknownSkill, "ok", [
          stringAttribute("nickname", "PRIVATE_NICKNAME"),
        ]),
      ]),
      metric("PRIVATE_NON_TARGET_METRIC", [successfulPoint("PRIVATE_VALUE")]),
    ]),
  );
  const snapshot = await collector.closeAndSnapshot();
  const serializedSnapshot = JSON.stringify(snapshot);
  const serializedOutputs = JSON.stringify({ snapshot, httpResult: result });

  assert.equal(snapshot.unrecognizedSkillObserved, true);
  for (const privateValue of privateValues) {
    assert.equal(serializedOutputs.includes(privateValue), false);
  }
  for (const prohibitedKey of [
    "prompt",
    "response",
    "reasoning",
    "transcript",
    "toolInput",
    "toolOutput",
    "taskResult",
    "counterValue",
    "asInt",
    "asDouble",
    "flags",
    "exemplars",
    "resourceAttributes",
    "scopeAttributes",
    "model",
    "account",
    "repository",
    "path",
    "credential",
    "agentId",
    "threadId",
    "parentThreadId",
    "turnId",
    "sessionId",
    "nickname",
    "timestamp",
  ]) {
    assert.equal(serializedSnapshot.includes(`"${prohibitedKey}"`), false);
  }
});
