import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import type { CodexSkillPresenceSnapshot } from "../../../src/index.js";
import {
  buildCodexExecArguments,
  buildIntegrationReport,
  buildScenarioResult,
  FIXTURE_AGENT_ROLE,
  FIXTURE_SKILL_IDS,
  formatConsoleSummary,
  parseRunnerArguments,
  reportRequiresFailure,
  requireSupportedCodexVersion,
  SCENARIO_DEFINITIONS,
  SCENARIO_IDS,
  type ScenarioId,
  type ScenarioObservation,
} from "../src/integration-config.js";

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

function supportedObservations(): Record<ScenarioId, ScenarioObservation> {
  return {
    direct: { snapshot: snapshot([FIXTURE_SKILL_IDS.direct]) },
    repeated: { snapshot: snapshot([FIXTURE_SKILL_IDS.direct]) },
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

test("accepts only the optional explicit output destination", () => {
  assert.deepEqual(parseRunnerArguments([]), {});
  assert.deepEqual(parseRunnerArguments(["--output", "/tmp/report.json"]), {
    outputPath: "/tmp/report.json",
  });
  assert.throws(() => parseRunnerArguments(["--output"]), /Usage:/);
  assert.throws(
    () => parseRunnerArguments(["--output", "one", "--output", "two"]),
    /Usage:/,
  );
  assert.throws(() => parseRunnerArguments(["--runs", "2"]), /Usage:/);
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
      }),
    /loopback/,
  );
});

test("reduces snapshots to presence without counts, edges, or attribution", () => {
  const direct = buildScenarioResult("direct", {
    snapshot: snapshot([FIXTURE_SKILL_IDS.direct], true),
  });
  const repeated = buildScenarioResult("repeated", {
    snapshot: snapshot([FIXTURE_SKILL_IDS.direct]),
  });
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
  assert.deepEqual(repeated.observedSkillIds, [FIXTURE_SKILL_IDS.direct]);
  assert.equal(repeated.status, "supported");
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
  const repeated = buildScenarioResult("repeated", {
    snapshot: snapshot([]),
  });
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
    [direct.status, repeated.status, nested.status, subagent.status],
    ["failed", "failed", "inconclusive", "inconclusive"],
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

test("reports only approved fields and fails the required baseline", () => {
  const supportedReport = buildIntegrationReport({
    codexVersion: "codex-cli 0.146.0",
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
  const summary = formatConsoleSummary(supportedReport);
  assert.match(summary, /Collector semantics: presence/);
  assert.match(summary, /presence confirmed/);
  assert.match(summary, /no runtime edge implied/);
  assert.match(summary, /agent attribution unavailable/);

  const failedObservations = supportedObservations();
  failedObservations.direct = { snapshot: snapshot([]) };
  assert.equal(
    reportRequiresFailure(
      buildIntegrationReport({
        codexVersion: "codex-cli 0.146.0",
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
