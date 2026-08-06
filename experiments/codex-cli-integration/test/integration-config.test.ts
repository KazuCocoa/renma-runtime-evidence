import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import type {
  CodexSkillEvidenceDiagnosticsSnapshot,
  CodexSkillPresenceSnapshot,
} from "../../../src/index.js";
import {
  buildCodexExecArguments,
  buildIntegrationReport,
  buildRepeatedScenarioResult,
  buildScenarioResult,
  classifyPipelineDiagnostics,
  FIXTURE_AGENT_ROLE,
  FIXTURE_SKILL_IDS,
  formatConsoleSummary,
  formatDiagnosticsSummary,
  formatDirectBaselineSummary,
  observeIndependentCollectorRuns,
  parseRunnerArguments,
  reportRequiresFailure,
  requireSupportedCodexVersion,
  SCENARIO_DEFINITIONS,
  SCENARIO_IDS,
  type IntegrationObservations,
  type ScenarioObservation,
} from "../src/integration-config.js";

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

function snapshot(
  injectedSkills: readonly string[],
  unrecognizedSkillObserved = false,
): CodexSkillPresenceSnapshot {
  return {
    schemaVersion: 1,
    provider: "codex",
    signal: "skill-injected",
    observationScope: "collector-lifetime",
    injectedSkills,
    unrecognizedSkillObserved,
  };
}

function supportedObservations(): IntegrationObservations {
  return {
    direct: { snapshot: snapshot([FIXTURE_SKILL_IDS.direct]) },
    repeated: [
      { snapshot: snapshot([FIXTURE_SKILL_IDS.direct]) },
      { snapshot: snapshot([FIXTURE_SKILL_IDS.direct]) },
    ],
    nested: {
      snapshot: snapshot([
        FIXTURE_SKILL_IDS.nestedChild,
        FIXTURE_SKILL_IDS.nestedParent,
      ]),
    },
    subagent: {
      snapshot: snapshot([
        FIXTURE_SKILL_IDS.subagentParent,
        FIXTURE_SKILL_IDS.subagentChild,
      ]),
    },
  };
}

test("defines four finite scenarios and repeats only the presence baseline", () => {
  assert.deepEqual(
    SCENARIO_DEFINITIONS.map(({ id }) => id),
    SCENARIO_IDS,
  );
  assert.equal(SCENARIO_DEFINITIONS.length, 4);
  const repeated = SCENARIO_DEFINITIONS.find(({ id }) => id === "repeated");
  assert.equal(repeated?.prompts.length, 2);
  assert.deepEqual(repeated?.allowedSkills, [FIXTURE_SKILL_IDS.direct]);
  assert.equal(
    SCENARIO_DEFINITIONS.find(({ id }) => id === "subagent")
      ?.requiresMultiAgent,
    true,
  );
  assert.equal(new Set(Object.values(FIXTURE_SKILL_IDS)).size, 5);
});

test("requires explicit analytics consent and accepts an optional output destination in either order", () => {
  assert.throws(() => parseRunnerArguments([]), /Explicit Codex analytics/);
  assert.throws(
    () => parseRunnerArguments(["--output", "/tmp/report.json"]),
    /Explicit Codex analytics/,
  );
  assert.deepEqual(parseRunnerArguments(["--allow-codex-analytics"]), {
    codexAnalyticsExplicitlyAllowed: true,
    directOnly: false,
  });
  assert.deepEqual(
    parseRunnerArguments([
      "--allow-codex-analytics",
      "--output",
      "/tmp/report.json",
    ]),
    {
      codexAnalyticsExplicitlyAllowed: true,
      directOnly: false,
      outputPath: "/tmp/report.json",
    },
  );
  assert.deepEqual(
    parseRunnerArguments([
      "--output",
      "/tmp/report.json",
      "--allow-codex-analytics",
    ]),
    {
      codexAnalyticsExplicitlyAllowed: true,
      directOnly: false,
      outputPath: "/tmp/report.json",
    },
  );
  assert.throws(
    () =>
      parseRunnerArguments([
        "--allow-codex-analytics",
        "--allow-codex-analytics",
      ]),
    /duplicate --allow-codex-analytics/,
  );
  assert.throws(
    () =>
      parseRunnerArguments([
        "--allow-codex-analytics",
        "--output",
        "one",
        "--output",
        "two",
      ]),
    /duplicate --output/,
  );
  assert.throws(
    () => parseRunnerArguments(["--allow-codex-analytics", "--output"]),
    /--output requires a path/,
  );
  assert.throws(
    () => parseRunnerArguments(["--output", "--allow-codex-analytics"]),
    /--output requires a path/,
  );
  assert.throws(
    () => parseRunnerArguments(["--allow-codex-analytics", "--runs"]),
    /unknown option/,
  );
  assert.deepEqual(
    parseRunnerArguments(["--allow-codex-analytics", "--direct-only"]),
    { codexAnalyticsExplicitlyAllowed: true, directOnly: true },
  );
  assert.throws(
    () =>
      parseRunnerArguments([
        "--allow-codex-analytics",
        "--direct-only",
        "--direct-only",
      ]),
    /duplicate --direct-only/,
  );
});

test("classifies the six bounded pipeline stages in order", () => {
  assert.equal(classifyPipelineDiagnostics(diagnostics()), "no-otlp-request");
  assert.equal(
    classifyPipelineDiagnostics(
      diagnostics({ otlpMetricsRequestsReceived: 1, decodeFailures: 1 }),
    ),
    "request-decode-failure",
  );
  assert.equal(
    classifyPipelineDiagnostics(
      diagnostics({
        otlpMetricsRequestsReceived: 1,
        successfullyDecodedRequests: 1,
        metricsInspected: 2,
      }),
    ),
    "decoded-without-metric-datapoints",
  );
  assert.equal(
    classifyPipelineDiagnostics(
      diagnostics({
        otlpMetricsRequestsReceived: 1,
        successfullyDecodedRequests: 1,
        metricDataPointsInspected: 3,
      }),
    ),
    "non-target-metric-datapoints-only",
  );
  assert.equal(
    classifyPipelineDiagnostics(
      diagnostics({
        otlpMetricsRequestsReceived: 1,
        successfullyDecodedRequests: 1,
        metricDataPointsInspected: 1,
        targetDataPointsObserved: 1,
        targetDataPointsWithStatusError: 1,
      }),
    ),
    "target-datapoints-rejected",
  );
  assert.equal(
    classifyPipelineDiagnostics(
      diagnostics({
        otlpMetricsRequestsReceived: 1,
        successfullyDecodedRequests: 1,
        metricDataPointsInspected: 1,
        targetDataPointsObserved: 1,
        acceptedAllowlistedSkillDataPoints: 1,
      }),
    ),
    "accepted-skill-evidence",
  );
});

test("requires a compatible semantic Codex CLI version", () => {
  assert.equal(
    requireSupportedCodexVersion("codex-cli 0.146.0\n"),
    "codex-cli 0.146.0",
  );
  assert.equal(
    requireSupportedCodexVersion("codex-cli 1.0.0"),
    "codex-cli 1.0.0",
  );
  assert.throws(
    () => requireSupportedCodexVersion("codex-cli 0.145.9"),
    /0\.146\.0 or newer/,
  );
  assert.throws(
    () => requireSupportedCodexVersion("PRIVATE_VERSION_OUTPUT"),
    /Unable to determine/,
  );
});

test("builds strict invocation-only telemetry configuration", () => {
  const prompt = "SYNTHETIC_PROMPT";
  const directArgs = buildCodexExecArguments({
    collectorEndpoint: "http://127.0.0.1:4318/v1/metrics",
    prompt,
    temporaryRepository: "/synthetic/repository",
    enableMultiAgent: false,
    codexAnalyticsExplicitlyAllowed: true,
  });

  for (const required of [
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--strict-config",
    "read-only",
    'approval_policy="never"',
    "analytics.enabled=true",
    "otel.log_user_prompt=false",
    'otel.exporter="none"',
    'otel.trace_exporter="none"',
  ]) {
    assert.equal(directArgs.includes(required), true);
  }
  assert.equal(
    directArgs.some((argument) =>
      argument.includes(
        'otel.metrics_exporter={ otlp-http = { endpoint = "http://127.0.0.1:4318/v1/metrics", protocol = "json" } }',
      ),
    ),
    true,
  );
  assert.equal(directArgs.includes("multi_agent"), false);
  assert.equal(directArgs.at(-1), prompt);
  assert.equal(directArgs.includes("--json"), false);
  assert.equal(
    directArgs.includes("--dangerously-bypass-approvals-and-sandbox"),
    false,
  );

  const subagentArgs = buildCodexExecArguments({
    collectorEndpoint: "http://127.0.0.1:4318/v1/metrics",
    prompt,
    temporaryRepository: "/synthetic/repository",
    enableMultiAgent: true,
    codexAnalyticsExplicitlyAllowed: true,
  });
  assert.equal(subagentArgs.includes("multi_agent"), true);
  assert.equal(subagentArgs.includes("agents.enabled=true"), true);
  assert.throws(
    () =>
      buildCodexExecArguments({
        collectorEndpoint: "https://collector.example/v1/metrics",
        prompt,
        temporaryRepository: "/synthetic/repository",
        enableMultiAgent: false,
        codexAnalyticsExplicitlyAllowed: true,
      }),
    /loopback/,
  );
  assert.throws(
    () =>
      buildCodexExecArguments({
        collectorEndpoint: "http://127.0.0.1:4318/v1/metrics",
        prompt,
        temporaryRepository: "/synthetic/repository",
        enableMultiAgent: false,
        codexAnalyticsExplicitlyAllowed: false as true,
      }),
    /Explicit Codex analytics consent required/,
  );
});

test("reduces snapshots to presence without counts, edges, or attribution", () => {
  const direct = buildScenarioResult("direct", {
    snapshot: snapshot([FIXTURE_SKILL_IDS.direct], true),
  });
  const repeated = buildRepeatedScenarioResult([
    { snapshot: snapshot([FIXTURE_SKILL_IDS.direct]) },
    { snapshot: snapshot([FIXTURE_SKILL_IDS.direct]) },
  ]);
  const nested = buildScenarioResult("nested", {
    snapshot: snapshot([
      FIXTURE_SKILL_IDS.nestedParent,
      FIXTURE_SKILL_IDS.nestedChild,
    ]),
  });
  const subagent = buildScenarioResult("subagent", {
    snapshot: snapshot([FIXTURE_SKILL_IDS.subagentChild]),
  });

  assert.equal(direct.status, "supported");
  assert.equal(direct.unrecognizedSkillObserved, true);
  assert.equal(repeated.status, "supported");
  assert.deepEqual(
    repeated.runs.map((run) => run.observedSkillIds),
    [[FIXTURE_SKILL_IDS.direct], [FIXTURE_SKILL_IDS.direct]],
  );
  assert.equal(nested.status, "supported");
  assert.equal(nested.runtimeEdgeClaimed, false);
  assert.equal(subagent.status, "supported");
  assert.equal(subagent.agentAttributionClaimed, false);

  const serialized = JSON.stringify({ direct, repeated, nested, subagent });
  assert.equal(serialized.includes("occurrence"), false);
  assert.equal(serialized.includes("injectionCount"), false);
  assert.equal(serialized.includes("sessionId"), false);
});

test("keeps optional absences inconclusive and hard baseline absences failed", () => {
  const direct = buildScenarioResult("direct", { snapshot: snapshot([]) });
  const nested = buildScenarioResult("nested", {
    snapshot: snapshot([FIXTURE_SKILL_IDS.nestedParent]),
  });
  const subagent = buildScenarioResult("subagent", {
    snapshot: snapshot([FIXTURE_SKILL_IDS.subagentParent]),
  });
  const unavailableSubagent = buildScenarioResult("subagent", {
    diagnostic: "multi-agent-unavailable",
  });

  assert.deepEqual(
    [direct.status, nested.status, subagent.status],
    ["failed", "inconclusive", "inconclusive"],
  );
  assert.equal(unavailableSubagent.status, "unsupported");
  assert.equal(nested.runtimeEdgeClaimed, false);
  assert.equal(subagent.agentAttributionClaimed, false);
  assert.equal(
    buildScenarioResult("nested", { diagnostic: "process-timeout" }).status,
    "failed",
  );
  assert.equal(
    buildScenarioResult("subagent", {
      diagnostic: "process-exit-nonzero",
    }).status,
    "unsupported",
  );
});

test("requires two successful repeated processes with presence in both snapshots", () => {
  const present = (): ScenarioObservation => ({
    snapshot: snapshot([FIXTURE_SKILL_IDS.direct]),
  });
  const absent = (): ScenarioObservation => ({ snapshot: snapshot([]) });
  const failed = (): ScenarioObservation => ({
    snapshot: snapshot([FIXTURE_SKILL_IDS.direct]),
    diagnostic: "process-exit-nonzero",
  });
  const cases: readonly {
    readonly name: string;
    readonly observations: readonly [ScenarioObservation, ScenarioObservation];
    readonly runStatuses: readonly [
      "supported" | "failed",
      "supported" | "failed",
    ];
  }[] = [
    {
      name: "both present",
      observations: [present(), present()],
      runStatuses: ["supported", "supported"],
    },
    {
      name: "first only",
      observations: [present(), absent()],
      runStatuses: ["supported", "failed"],
    },
    {
      name: "second only",
      observations: [absent(), present()],
      runStatuses: ["failed", "supported"],
    },
    {
      name: "neither",
      observations: [absent(), absent()],
      runStatuses: ["failed", "failed"],
    },
    {
      name: "first process failure",
      observations: [failed(), present()],
      runStatuses: ["failed", "supported"],
    },
    {
      name: "second process failure",
      observations: [present(), failed()],
      runStatuses: ["supported", "failed"],
    },
  ];

  for (const fixture of cases) {
    const result = buildRepeatedScenarioResult(fixture.observations);
    assert.deepEqual(
      result.runs.map(({ status }) => status),
      fixture.runStatuses,
      fixture.name,
    );
    assert.equal(
      result.status,
      fixture.name === "both present" ? "supported" : "failed",
      fixture.name,
    );
  }
});

test("uses a fresh collector lifetime for each repeated run", async () => {
  const events: string[] = [];
  const endpoints: string[] = [];
  let collectorNumber = 0;

  const observations = await observeIndependentCollectorRuns({
    allowedSkills: [FIXTURE_SKILL_IDS.direct],
    prompts: ["FIRST_SYNTHETIC_PROMPT", "SECOND_SYNTHETIC_PROMPT"],
    createCollector: async (allowedSkills) => {
      assert.deepEqual(allowedSkills, [FIXTURE_SKILL_IDS.direct]);
      collectorNumber += 1;
      const current = collectorNumber;
      const endpoint = `http://127.0.0.1:${4300 + current}/v1/metrics`;
      let closed = false;
      endpoints.push(endpoint);
      events.push(`create:${current}`);
      return {
        endpoint,
        diagnosticsSnapshot: () =>
          diagnostics({
            otlpMetricsRequestsReceived: 1,
            successfullyDecodedRequests: 1,
          }),
        closeAndSnapshot: async () => {
          if (!closed) {
            closed = true;
            events.push(`close:${current}`);
          }
          return snapshot([FIXTURE_SKILL_IDS.direct]);
        },
      };
    },
    runCodex: async ({ collectorEndpoint, prompt }) => {
      events.push(`run:${collectorEndpoint}:${prompt}`);
      return prompt === "FIRST_SYNTHETIC_PROMPT"
        ? "process-exit-nonzero"
        : undefined;
    },
  });

  assert.equal(new Set(endpoints).size, 2);
  assert.deepEqual(events, [
    "create:1",
    `run:${endpoints[0]}:FIRST_SYNTHETIC_PROMPT`,
    "close:1",
    "create:2",
    `run:${endpoints[1]}:SECOND_SYNTHETIC_PROMPT`,
    "close:2",
  ]);
  assert.deepEqual(
    observations.map(
      ({ snapshot: observedSnapshot }) => observedSnapshot?.injectedSkills,
    ),
    [[FIXTURE_SKILL_IDS.direct], [FIXTURE_SKILL_IDS.direct]],
  );
  assert.deepEqual(
    observations.map(({ diagnostic }) => diagnostic),
    ["process-exit-nonzero", undefined],
  );
  assert.deepEqual(
    observations.map(
      ({ diagnostics: observedDiagnostics }) =>
        observedDiagnostics?.otlpMetricsRequestsReceived,
    ),
    [1, 1],
  );
});

test("prints separate diagnostics while keeping them out of serialized public results", () => {
  const observations = supportedObservations();
  const directDiagnostics = diagnostics({
    otlpMetricsRequestsReceived: 2,
    successfullyDecodedRequests: 2,
    metricDataPointsInspected: 4,
    targetDataPointsObserved: 1,
    acceptedAllowlistedSkillDataPoints: 1,
  });
  const observationsWithDiagnostics: IntegrationObservations = {
    ...observations,
    direct: {
      ...observations.direct,
      diagnostics: directDiagnostics,
    },
  };
  const report = buildIntegrationReport({
    codexVersion: "codex-cli 0.146.0",
    codexAnalyticsExplicitlyAllowed: true,
    observations: observationsWithDiagnostics,
  });
  const serializedPublicReport = JSON.stringify(report);
  const diagnosticSummary = formatDiagnosticsSummary(
    observationsWithDiagnostics,
  );
  const directSummary = formatDirectBaselineSummary({
    codexVersion: "codex-cli 0.146.0",
    observation: observationsWithDiagnostics.direct,
  });

  assert.equal(serializedPublicReport.includes("otlpMetricsRequests"), false);
  assert.equal(serializedPublicReport.includes("pipeline"), false);
  assert.match(diagnosticSummary, /not public Skill evidence/);
  assert.match(diagnosticSummary, /accepted-skill-evidence/);
  assert.match(diagnosticSummary, /nested: unavailable/);
  assert.match(directSummary, /Command category: direct single-Skill baseline/);
  assert.match(directSummary, /accepted-skill-evidence/);
  assert.match(directSummary, /no execution, count, ordering/);
});

test("reports only approved fields and fails the required baseline", () => {
  const supportedReport = buildIntegrationReport({
    codexVersion: "codex-cli 0.146.0",
    codexAnalyticsExplicitlyAllowed: true,
    observations: supportedObservations(),
  });
  assert.equal(reportRequiresFailure(supportedReport), false);
  assert.deepEqual(supportedReport.limitations, {
    skillExecutionClaimed: false,
    orderingClaimed: false,
    sessionAttributionClaimed: false,
    nestingEdgeClaimed: false,
    agentAttributionClaimed: false,
    instructionComplianceClaimed: false,
    taskSuccessClaimed: false,
  });
  assert.equal(supportedReport.exportedMetric, "codex.skill.injected");
  assert.equal(supportedReport.codexAnalyticsExplicitlyAllowed, true);
  const summary = formatConsoleSummary(supportedReport);
  assert.match(summary, /Collector semantics: presence/);
  assert.match(summary, /Codex analytics explicitly allowed: true/);
  assert.match(summary, /run 1:/);
  assert.match(summary, /run 2:/);
  assert.match(summary, /no runtime edge implied/);
  assert.match(summary, /agent attribution unavailable/);

  const failedObservations: IntegrationObservations = {
    ...supportedObservations(),
    direct: { snapshot: snapshot([]) },
  };
  assert.equal(
    reportRequiresFailure(
      buildIntegrationReport({
        codexVersion: "codex-cli 0.146.0",
        codexAnalyticsExplicitlyAllowed: true,
        observations: failedObservations,
      }),
    ),
    true,
  );
});

test("keeps every fixture synthetic, exact, and project-scoped", async () => {
  const testDirectory = dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = resolve(testDirectory, "../../../..");
  const fixtureRoot = join(
    repositoryRoot,
    "experiments/codex-cli-integration/fixtures",
  );
  const skillDirectories = await readdir(join(fixtureRoot, "skills"));
  assert.deepEqual(
    skillDirectories.sort(),
    Object.values(FIXTURE_SKILL_IDS).sort(),
  );

  for (const skillId of Object.values(FIXTURE_SKILL_IDS)) {
    const contents = await readFile(
      join(fixtureRoot, "skills", skillId, "SKILL.md"),
      "utf8",
    );
    assert.equal(contents.includes(`\nname: ${skillId}\n`), true);
    assert.match(contents, /synthetic runtime-evidence integration fixture/i);
  }

  const agentFiles = await readdir(join(fixtureRoot, "agents"));
  assert.deepEqual(agentFiles, [`${FIXTURE_AGENT_ROLE}.toml`]);
  const agent = await readFile(
    join(fixtureRoot, "agents", `${FIXTURE_AGENT_ROLE}.toml`),
    "utf8",
  );
  assert.equal(agent.includes(`name = "${FIXTURE_AGENT_ROLE}"`), true);
  assert.equal(agent.includes(`$${FIXTURE_SKILL_IDS.subagentChild}`), true);
  assert.equal(/^model\s*=/mu.test(agent), false);
  assert.equal(/^model_reasoning_effort\s*=/mu.test(agent), false);
});
