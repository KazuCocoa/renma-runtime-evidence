import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  EXPECTED_CODEX_VERSION,
  REQUESTED_MODEL,
  REQUESTED_REASONING_EFFORT,
  RUNS_PER_SCENARIO,
} from "../src/runner-config.js";
import {
  EXPERIMENT_ID,
  isSpawnRoleClassification,
  isSyntheticAgentRole,
  SCENARIO_IDS,
  SPAWN_ROLE_CLASSIFICATIONS,
  SYNTHETIC_AGENT_ROLES,
} from "../src/signals.js";

type UnknownRecord = Record<string, unknown>;

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "../../../..");
const experimentDirectory = join(
  repositoryRoot,
  "experiments/codex-subagent-spawn-signals",
);
const evidencePath = join(
  experimentDirectory,
  "evidence/codex-cli-0.146.0.json",
);

function asRecord(value: unknown): UnknownRecord {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as UnknownRecord;
}

function asArray(value: unknown): unknown[] {
  assert.equal(Array.isArray(value), true);
  return value as unknown[];
}

function sortedKeys(value: UnknownRecord): string[] {
  return Object.keys(value).sort();
}

async function readOptionalEvidence(): Promise<string | undefined> {
  try {
    return await readFile(evidencePath, "utf8");
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return undefined;
    }
    throw error;
  }
}

test("strict schema mirrors every finite report domain and cardinality", async () => {
  const schema = asRecord(
    JSON.parse(
      await readFile(
        join(experimentDirectory, "schema/spawn-signals-report.schema.json"),
        "utf8",
      ),
    ) as unknown,
  );
  assert.equal(schema.type, "object");
  assert.equal(schema.additionalProperties, false);
  const rootProperties = asRecord(schema.properties);
  assert.equal(asRecord(rootProperties.runsPerScenario).const, 3);
  const environmentProperties = asRecord(
    asRecord(rootProperties.environment).properties,
  );
  assert.equal(
    asRecord(environmentProperties.codexVersion).const,
    EXPECTED_CODEX_VERSION,
  );
  const modelProperties = asRecord(
    asRecord(rootProperties.modelConfiguration).properties,
  );
  assert.equal(asRecord(modelProperties.requestedModel).const, REQUESTED_MODEL);
  assert.equal(
    asRecord(modelProperties.requestedReasoningEffort).const,
    REQUESTED_REASONING_EFFORT,
  );
  assert.equal(
    asRecord(rootProperties.authenticationIsolationMode).const,
    "api-key",
  );
  const scenarios = asRecord(rootProperties.scenarios);
  assert.equal(scenarios.minItems, SCENARIO_IDS.length);
  assert.equal(scenarios.maxItems, SCENARIO_IDS.length);
  assert.equal(asArray(scenarios.prefixItems).length, SCENARIO_IDS.length);

  const definitions = asRecord(schema.$defs);
  assert.deepEqual(asRecord(definitions.scenarioId).enum, SCENARIO_IDS);
  assert.deepEqual(asRecord(definitions.agentRole).enum, SYNTHETIC_AGENT_ROLES);
  assert.deepEqual(
    asRecord(definitions.roleClassification).enum,
    SPAWN_ROLE_CLASSIFICATIONS,
  );
  const scenarioSummary = asRecord(definitions.scenarioSummary);
  const runArray = asRecord(asRecord(scenarioSummary.properties).runs);
  assert.equal(runArray.minItems, RUNS_PER_SCENARIO);
  assert.equal(runArray.maxItems, RUNS_PER_SCENARIO);
  const runSummary = asRecord(definitions.runSummary);
  assert.equal(runSummary.additionalProperties, false);
  assert.deepEqual(runSummary.required, [
    "schemaVersion",
    "provider",
    "experiment",
    "scenario",
    "codexExitCode",
    "spawnMetricObserved",
    "spawnDataPointObserved",
    "spawnRoleClassifications",
    "spawnedRoles",
  ]);
});

test("README states the regeneration blocker when evidence is absent", async () => {
  const [evidence, readme] = await Promise.all([
    readOptionalEvidence(),
    readFile(join(experimentDirectory, "README.md"), "utf8"),
  ]);
  if (evidence !== undefined) {
    assert.doesNotMatch(readme, /Runtime evidence status: not generated/);
    return;
  }

  assert.match(readme, /Runtime evidence status: not generated/);
  assert.match(readme, /`CODEX_API_KEY` is unavailable/);
  assert.match(readme, /saved-login fallback is prohibited/);
  assert.doesNotMatch(readme, /^### Actual normalized observations$/m);
});

test("committed evidence is finite and exactly matches the README when present", async (t) => {
  const evidenceContents = await readOptionalEvidence();
  if (evidenceContents === undefined) {
    t.skip("No runtime evidence was generated under the isolated API-key mode");
    return;
  }
  const readme = await readFile(join(experimentDirectory, "README.md"), "utf8");
  const report = asRecord(JSON.parse(evidenceContents) as unknown);
  assert.deepEqual(sortedKeys(report), [
    "authenticationIsolationMode",
    "environment",
    "experiment",
    "experimentDate",
    "modelConfiguration",
    "provider",
    "runsPerScenario",
    "scenarios",
    "schemaVersion",
  ]);
  assert.equal(report.experiment, EXPERIMENT_ID);
  assert.equal(report.authenticationIsolationMode, "api-key");
  assert.equal(report.runsPerScenario, RUNS_PER_SCENARIO);
  assert.equal(
    asRecord(report.environment).codexVersion,
    EXPECTED_CODEX_VERSION,
  );
  const model = asRecord(report.modelConfiguration);
  assert.equal(model.requestedModel, REQUESTED_MODEL);
  assert.equal(model.requestedReasoningEffort, REQUESTED_REASONING_EFFORT);

  const expectedRows: string[] = [];
  const scenarios = asArray(report.scenarios);
  assert.equal(scenarios.length, SCENARIO_IDS.length);
  for (const [scenarioIndex, scenarioCandidate] of scenarios.entries()) {
    const scenario = asRecord(scenarioCandidate);
    assert.equal(scenario.scenario, SCENARIO_IDS[scenarioIndex]);
    const runs = asArray(scenario.runs);
    assert.equal(runs.length, RUNS_PER_SCENARIO);
    for (const [runIndex, runCandidate] of runs.entries()) {
      const run = asRecord(runCandidate);
      assert.deepEqual(sortedKeys(run), [
        "codexExitCode",
        "experiment",
        "provider",
        "scenario",
        "schemaVersion",
        "spawnDataPointObserved",
        "spawnMetricObserved",
        "spawnRoleClassifications",
        "spawnedRoles",
      ]);
      assert.equal(run.scenario, scenario.scenario);
      assert.equal(run.codexExitCode, 0);
      const classifications = asArray(run.spawnRoleClassifications);
      const roles = asArray(run.spawnedRoles);
      assert.deepEqual(classifications, [...new Set(classifications)].sort());
      assert.deepEqual(roles, [...new Set(roles)].sort());
      assert.equal(classifications.every(isSpawnRoleClassification), true);
      assert.equal(roles.every(isSyntheticAgentRole), true);
      expectedRows.push(
        `| \`${String(scenario.scenario)}\` | ${runIndex + 1} | \`${String(run.spawnMetricObserved)}\` | \`${String(run.spawnDataPointObserved)}\` | \`${JSON.stringify(classifications)}\` | \`${JSON.stringify(roles)}\` |`,
      );
    }
  }
  for (const row of expectedRows) {
    assert.equal(readme.includes(row), true);
  }

  const prohibitedKeys = new Set([
    "prompt",
    "response",
    "reasoning",
    "transcript",
    "toolInput",
    "toolOutput",
    "credential",
    "path",
    "agentId",
    "threadId",
    "parentThreadId",
    "nickname",
    "experimentRunId",
    "collectorReceipt",
    "resourceAttributes",
    "scopeAttributes",
    "exemplars",
    "counterValue",
    "taskResult",
    "injectedSkills",
  ]);
  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== "object" || value === null) {
      return;
    }
    for (const [key, nested] of Object.entries(value)) {
      assert.equal(prohibitedKeys.has(key), false);
      visit(nested);
    }
  }
  visit(report);
});
