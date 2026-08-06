import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  isScenarioId,
  isSyntheticAgentRole,
  isSyntheticSkillName,
  SCENARIO_IDS,
  SYNTHETIC_AGENT_ROLES,
  SYNTHETIC_SKILL_NAMES,
} from "../src/allowlist.js";
import { SUPPORTED_REASONING_EFFORTS } from "../src/runner-config.js";

type UnknownRecord = Record<string, unknown>;

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "../../../..");
const experimentDirectory = join(
  repositoryRoot,
  "experiments/codex-skill-topology-boundaries",
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

function parsePresenceArray(contents: string): string[] {
  return contents ? contents.split(", ") : [];
}

test("committed evidence conforms to the finite normalized schema boundary", async () => {
  const [evidenceContents, schemaContents] = await Promise.all([
    readFile(
      join(experimentDirectory, "evidence/codex-cli-0.146.0.json"),
      "utf8",
    ),
    readFile(
      join(
        experimentDirectory,
        "schema/topology-boundaries-report.schema.json",
      ),
      "utf8",
    ),
  ]);
  const report = asRecord(JSON.parse(evidenceContents) as unknown);
  const schema = asRecord(JSON.parse(schemaContents) as unknown);

  assert.deepEqual(sortedKeys(report), [
    "environment",
    "experiment",
    "experimentDate",
    "modelConfiguration",
    "provider",
    "runsPerScenario",
    "scenarios",
    "schemaVersion",
  ]);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.provider, "codex");
  assert.equal(report.experiment, "codex-skill-topology-boundaries");
  assert.equal(report.runsPerScenario, 3);
  assert.equal("authenticationIsolationMode" in report, false);

  const environment = asRecord(report.environment);
  assert.deepEqual(sortedKeys(environment), [
    "architecture",
    "codexVersion",
    "nodeVersion",
    "operatingSystem",
  ]);

  const modelConfiguration = asRecord(report.modelConfiguration);
  assert.deepEqual(sortedKeys(modelConfiguration), [
    "requestedModel",
    "requestedReasoningEffort",
  ]);
  assert.equal(modelConfiguration.requestedModel, "gpt-5.6-sol");
  assert.equal(modelConfiguration.requestedReasoningEffort, "medium");
  assert.equal(
    SUPPORTED_REASONING_EFFORTS.some(
      (effort) => effort === modelConfiguration.requestedReasoningEffort,
    ),
    true,
  );

  const scenarios = asArray(report.scenarios);
  assert.equal(scenarios.length, SCENARIO_IDS.length);
  for (const [scenarioIndex, scenarioCandidate] of scenarios.entries()) {
    const scenario = asRecord(scenarioCandidate);
    assert.deepEqual(sortedKeys(scenario), ["runs", "scenario"]);
    assert.equal(scenario.scenario, SCENARIO_IDS[scenarioIndex]);
    assert.equal(isScenarioId(scenario.scenario), true);

    const runs = asArray(scenario.runs);
    assert.equal(runs.length, 3);
    for (const runCandidate of runs) {
      const run = asRecord(runCandidate);
      const injectedSkills = asArray(run.injectedSkills);
      const spawnedRoles = asArray(run.spawnedRoles);
      const requiredKeys = [
        "codexExitCode",
        "experiment",
        "experimentRunId",
        "injectedSkills",
        "provider",
        "scenario",
        "schemaVersion",
        "spawnedRoles",
      ];
      const optionalKeys = ["collectorReceipt", "verifiedSkillStatus"];
      assert.deepEqual(
        sortedKeys(run).filter((key) => !optionalKeys.includes(key)),
        requiredKeys.sort(),
      );
      assert.equal(run.codexExitCode, 0);
      assert.equal(run.scenario, scenario.scenario);
      assert.match(String(run.experimentRunId), /^[0-9a-f-]{36}$/);
      assert.deepEqual(injectedSkills, [...new Set(injectedSkills)].sort());
      assert.deepEqual(spawnedRoles, [...new Set(spawnedRoles)].sort());
      assert.equal(injectedSkills.every(isSyntheticSkillName), true);
      assert.equal(spawnedRoles.every(isSyntheticAgentRole), true);

      if (injectedSkills.length > 0) {
        assert.equal(run.verifiedSkillStatus, "ok");
      } else {
        assert.equal("verifiedSkillStatus" in run, false);
      }
      if (injectedSkills.length > 0 || spawnedRoles.length > 0) {
        const receipt = asRecord(run.collectorReceipt);
        assert.deepEqual(sortedKeys(receipt), ["firstAcceptedAt"]);
        assert.match(String(receipt.firstAcceptedAt), /^\d{4}-\d{2}-\d{2}T/);
      } else {
        assert.equal("collectorReceipt" in run, false);
      }
    }
  }

  const definitions = asRecord(schema.$defs);
  assert.deepEqual(asRecord(definitions.scenarioId).enum, SCENARIO_IDS);
  assert.deepEqual(asRecord(definitions.skillName).enum, SYNTHETIC_SKILL_NAMES);
  assert.deepEqual(asRecord(definitions.agentRole).enum, SYNTHETIC_AGENT_ROLES);
  const schemaProperties = asRecord(schema.properties);
  const modelSchema = asRecord(schemaProperties.modelConfiguration);
  assert.deepEqual(modelSchema.required, [
    "requestedModel",
    "requestedReasoningEffort",
  ]);
  assert.equal(
    asRecord(schemaProperties.authenticationIsolationMode).const,
    "api-key",
  );

  const prohibitedKeys = new Set([
    "prompt",
    "response",
    "reasoning",
    "transcript",
    "toolInput",
    "toolOutput",
    "agentId",
    "threadId",
    "parentThreadId",
    "nickname",
    "exemplars",
    "counterValue",
    "taskResult",
    "edges",
    "associations",
    "HOME",
    "CODEX_HOME",
    "CODEX_API_KEY",
  ]);
  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== "object" || value === null) {
      return;
    }
    for (const [key, nestedValue] of Object.entries(value)) {
      assert.equal(prohibitedKeys.has(key), false);
      visit(nestedValue);
    }
  }
  visit(report);
});

test("README presence table exactly matches retained evidence", async () => {
  const [evidenceContents, readme] = await Promise.all([
    readFile(
      join(experimentDirectory, "evidence/codex-cli-0.146.0.json"),
      "utf8",
    ),
    readFile(join(experimentDirectory, "README.md"), "utf8"),
  ]);
  const report = asRecord(JSON.parse(evidenceContents) as unknown);
  const scenarios = asArray(report.scenarios);
  const tableStart = readme.indexOf("### Actual normalized presence sets");
  const tableEnd = readme.indexOf(
    "The retained output-allowlisted evidence",
    tableStart,
  );
  assert.notEqual(tableStart, -1);
  assert.notEqual(tableEnd, -1);
  assert.match(
    readme,
    /committed artifact predates that control.*artifact was left unchanged/s,
  );
  assert.match(
    readme,
    /Input isolation and output filtering are separate controls/,
  );
  const table = readme.slice(tableStart, tableEnd);
  const rowPattern =
    /^\|\s*`([^`]+)`\s*\|\s*(\d+)\s*\|\s*`\[([^\]]*)\]`\s*\|\s*`\[([^\]]*)\]`\s*\|$/gm;
  const actualRows = [...table.matchAll(rowPattern)].map((match) => ({
    scenario: match[1],
    run: Number(match[2]),
    injectedSkills: parsePresenceArray(match[3] ?? ""),
    spawnedRoles: parsePresenceArray(match[4] ?? ""),
  }));
  const expectedRows = scenarios.flatMap((scenarioCandidate) => {
    const scenario = asRecord(scenarioCandidate);
    return asArray(scenario.runs).map((runCandidate, runIndex) => {
      const run = asRecord(runCandidate);
      return {
        scenario: scenario.scenario,
        run: runIndex + 1,
        injectedSkills: run.injectedSkills,
        spawnedRoles: run.spawnedRoles,
      };
    });
  });

  assert.deepEqual(actualRows, expectedRows);
});
