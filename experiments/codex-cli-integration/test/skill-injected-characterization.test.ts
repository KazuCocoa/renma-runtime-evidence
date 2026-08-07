import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import type {
  CodexSkillEvidenceDiagnosticsSnapshot,
  CodexSkillPresenceSnapshot,
} from "../../../src/index.js";
import {
  buildCharacterizationChildEnvironment,
  buildSkillInjectedCharacterizationReport,
  CHARACTERIZATION_EXECUTION_ENVIRONMENT_VARIABLES,
  CHARACTERIZATION_SCENARIOS,
  CHARACTERIZATION_SCENARIO_IDS,
  CHARACTERIZATION_SKILLS,
  characterizationReportRequiresFailure,
  cleanupCharacterizationIsolatedDirectories,
  createCharacterizationIsolatedDirectories,
  fixedArtifactMatches,
  loadCharacterizationFixtureContents,
  parseCharacterizationRunnerArguments,
  preflightCharacterizationIsolation,
  type CharacterizationProcessStatus,
  type CharacterizationScenarioId,
  type CharacterizationScenarioObservation,
} from "../src/skill-injected-characterization.js";
import { buildCodexExecArguments } from "../src/integration-config.js";

function diagnostics(
  overrides: Partial<CodexSkillEvidenceDiagnosticsSnapshot> = {},
): CodexSkillEvidenceDiagnosticsSnapshot {
  return {
    schemaVersion: 1,
    otlpMetricsRequestsReceived: 1,
    successfullyDecodedRequests: 1,
    decodeFailures: 0,
    requestReadFailures: 0,
    requestBodyTooLargeFailures: 0,
    jsonParseFailures: 0,
    otlpValidationFailures: 0,
    resourceMetricsEntriesInspected: 1,
    scopeMetricsEntriesInspected: 1,
    metricsInspected: 1,
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
    targetDataPointsWithCanonicalIntValue: 0,
    targetDataPointsWithJsonNumberIntValue: 0,
    targetDataPointsWithDoubleValue: 0,
    targetDataPointsWithMissingValue: 0,
    targetDataPointsWithConflictingValues: 0,
    targetDataPointsWithInvalidIntValue: 0,
    targetDataPointsWithInvalidDoubleValue: 0,
    targetDataPointsWithInvalidFlags: 0,
    acceptedAllowlistedSkillDataPoints: 0,
    unknownOrMissingSkillLabelDataPoints: 0,
    counterSaturationObserved: false,
    ...overrides,
  };
}

function snapshot(
  injectedSkills: readonly string[],
): CodexSkillPresenceSnapshot {
  return {
    schemaVersion: 1,
    provider: "codex",
    signal: "skill-injected",
    observationScope: "collector-lifetime",
    injectedSkills,
    unrecognizedSkillObserved: false,
  };
}

function expectedArtifacts(
  scenario: CharacterizationScenarioId,
): readonly [boolean, boolean] {
  return [scenario === "target-requested", scenario === "control-requested"];
}

function observation(
  scenario: CharacterizationScenarioId,
  injectedSkills: readonly string[],
  options: {
    readonly targetArtifactMatched?: boolean;
    readonly controlArtifactMatched?: boolean;
    readonly processStatus?: CharacterizationProcessStatus;
  } = {},
): CharacterizationScenarioObservation {
  const [expectedTarget, expectedControl] = expectedArtifacts(scenario);
  return {
    scenario,
    processStatus: options.processStatus ?? "completed",
    targetArtifactMatched: options.targetArtifactMatched ?? expectedTarget,
    controlArtifactMatched: options.controlArtifactMatched ?? expectedControl,
    snapshot: snapshot(injectedSkills),
    diagnostics: diagnostics({
      metricDataPointsInspected: Math.max(1, injectedSkills.length),
      targetMetricsObserved: injectedSkills.length > 0 ? 1 : 0,
      targetDataPointsObserved: injectedSkills.length,
      targetDataPointsWithStatusOk: injectedSkills.length,
      positiveTargetDataPoints: injectedSkills.length,
      targetDataPointsWithJsonNumberIntValue: injectedSkills.length,
      acceptedAllowlistedSkillDataPoints: injectedSkills.length,
    }),
  };
}

function observationsForPattern(
  pattern: "requested" | "all" | "none",
): CharacterizationScenarioObservation[] {
  const allSkills = [
    CHARACTERIZATION_SKILLS.target.id,
    CHARACTERIZATION_SKILLS.control.id,
  ];
  return CHARACTERIZATION_SCENARIO_IDS.map((scenario) => {
    let injectedSkills: readonly string[] = [];
    if (pattern === "all") {
      injectedSkills = allSkills;
    } else if (pattern === "requested") {
      injectedSkills =
        scenario === "target-requested"
          ? [CHARACTERIZATION_SKILLS.target.id]
          : scenario === "control-requested"
            ? [CHARACTERIZATION_SKILLS.control.id]
            : [];
    }
    return observation(scenario, injectedSkills);
  });
}

test("defines exactly two stable synthetic fixtures and three direct scenarios", async () => {
  assert.equal(new Set(Object.values(CHARACTERIZATION_SKILLS)).size, 2);
  assert.deepEqual(
    CHARACTERIZATION_SCENARIOS.map(({ id }) => id),
    CHARACTERIZATION_SCENARIO_IDS,
  );
  assert.deepEqual(
    CHARACTERIZATION_SCENARIOS.map(({ requestedSkill }) => requestedSkill),
    ["neither", "target", "control"],
  );
  const neitherPrompt = CHARACTERIZATION_SCENARIOS[0]?.prompt ?? "";
  assert.equal(
    neitherPrompt.includes(CHARACTERIZATION_SKILLS.target.id),
    false,
  );
  assert.equal(
    neitherPrompt.includes(CHARACTERIZATION_SKILLS.control.id),
    false,
  );
  assert.match(
    CHARACTERIZATION_SCENARIOS[1]?.prompt ?? "",
    new RegExp(`\\$${CHARACTERIZATION_SKILLS.target.id}`, "u"),
  );
  assert.match(
    CHARACTERIZATION_SCENARIOS[2]?.prompt ?? "",
    new RegExp(`\\$${CHARACTERIZATION_SKILLS.control.id}`, "u"),
  );

  const testDirectory = dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = resolve(testDirectory, "../../../..");
  const fixtureRoot = join(
    repositoryRoot,
    "experiments/codex-cli-integration/fixtures",
  );
  const fixtures = await loadCharacterizationFixtureContents(fixtureRoot);
  for (const kind of ["target", "control"] as const) {
    const specification = CHARACTERIZATION_SKILLS[kind];
    assert.match(
      fixtures[kind],
      /synthetic runtime-evidence integration fixture/iu,
    );
    assert.equal(fixtures[kind].includes(specification.id), true);
    assert.equal(fixtures[kind].includes(specification.artifactFileName), true);
    assert.equal(fixtures[kind].includes(specification.artifactToken), true);
  }
  assert.notEqual(
    CHARACTERIZATION_SKILLS.target.artifactFileName,
    CHARACTERIZATION_SKILLS.control.artifactFileName,
  );
  assert.notEqual(
    CHARACTERIZATION_SKILLS.target.artifactToken,
    CHARACTERIZATION_SKILLS.control.artifactToken,
  );
});

test("requires explicit analytics consent for the opt-in characterization", () => {
  assert.throws(
    () => parseCharacterizationRunnerArguments([]),
    /Explicit Codex analytics consent required/,
  );
  assert.deepEqual(
    parseCharacterizationRunnerArguments(["--allow-codex-analytics"]),
    { codexAnalyticsExplicitlyAllowed: true },
  );
  assert.deepEqual(
    parseCharacterizationRunnerArguments([
      "--output",
      "/tmp/synthetic-report.json",
      "--allow-codex-analytics",
    ]),
    {
      codexAnalyticsExplicitlyAllowed: true,
      outputPath: "/tmp/synthetic-report.json",
    },
  );
  assert.throws(
    () =>
      parseCharacterizationRunnerArguments([
        "--allow-codex-analytics",
        "--allow-codex-analytics",
      ]),
    /duplicate/,
  );
  assert.throws(
    () =>
      parseCharacterizationRunnerArguments([
        "--allow-codex-analytics",
        "--unknown",
      ]),
    /unknown option/,
  );
});

test("uses fresh isolated workspace, HOME, CODEX_HOME, and child environment per scenario", async () => {
  const parent = await mkdtemp(
    join(tmpdir(), "renma-characterization-isolation-test-"),
  );
  const sourceEnvironment: NodeJS.ProcessEnv = {
    PATH: "/synthetic/bin",
    LANG: "C",
    HOME: "/PRIVATE/CALLER/HOME",
    CODEX_HOME: "/PRIVATE/CALLER/CODEX_HOME",
    CODEX_API_KEY: "PRIVATE_API_KEY",
    PRIVATE_UNRELATED_VARIABLE: "PRIVATE_VALUE",
  };
  const first = await createCharacterizationIsolatedDirectories(parent);
  const second = await createCharacterizationIsolatedDirectories(parent);
  try {
    assert.notEqual(first.rootDirectory, second.rootDirectory);
    assert.notEqual(first.workspaceDirectory, second.workspaceDirectory);
    assert.notEqual(first.homeDirectory, second.homeDirectory);
    assert.notEqual(first.codexHomeDirectory, second.codexHomeDirectory);
    for (const directories of [first, second]) {
      const childEnvironment = buildCharacterizationChildEnvironment(
        sourceEnvironment,
        directories,
      );
      await preflightCharacterizationIsolation(childEnvironment, directories);
      assert.equal(childEnvironment.HOME, directories.homeDirectory);
      assert.equal(childEnvironment.CODEX_HOME, directories.codexHomeDirectory);
      assert.notEqual(childEnvironment.HOME, sourceEnvironment.HOME);
      assert.notEqual(
        childEnvironment.CODEX_HOME,
        sourceEnvironment.CODEX_HOME,
      );
      assert.equal("PRIVATE_UNRELATED_VARIABLE" in childEnvironment, false);
      assert.deepEqual(
        Object.keys(childEnvironment).sort(),
        [
          "CODEX_API_KEY",
          "CODEX_HOME",
          "HOME",
          ...CHARACTERIZATION_EXECUTION_ENVIRONMENT_VARIABLES.filter(
            (name) => sourceEnvironment[name] !== undefined,
          ),
        ].sort(),
      );
    }
  } finally {
    await Promise.all([
      cleanupCharacterizationIsolatedDirectories(first),
      cleanupCharacterizationIsolatedDirectories(second),
    ]);
    await rm(parent, { recursive: true, force: true });
  }
});

test("validates only exact fixed artifacts and removes the full scenario root", async () => {
  const directories = await createCharacterizationIsolatedDirectories();
  await writeFile(
    join(
      directories.workspaceDirectory,
      CHARACTERIZATION_SKILLS.target.artifactFileName,
    ),
    CHARACTERIZATION_SKILLS.target.artifactToken,
    "utf8",
  );
  await writeFile(
    join(
      directories.workspaceDirectory,
      CHARACTERIZATION_SKILLS.control.artifactFileName,
    ),
    "PRIVATE_WRONG_TOKEN",
    "utf8",
  );
  assert.equal(
    await fixedArtifactMatches(directories.workspaceDirectory, "target"),
    true,
  );
  assert.equal(
    await fixedArtifactMatches(directories.workspaceDirectory, "control"),
    false,
  );
  const controlPath = join(
    directories.workspaceDirectory,
    CHARACTERIZATION_SKILLS.control.artifactFileName,
  );
  const symlinkTarget = join(
    directories.workspaceDirectory,
    "private-symlink-target",
  );
  await rm(controlPath);
  await writeFile(
    symlinkTarget,
    CHARACTERIZATION_SKILLS.control.artifactToken,
    "utf8",
  );
  await symlink(symlinkTarget, controlPath);
  assert.equal(
    await fixedArtifactMatches(directories.workspaceDirectory, "control"),
    false,
  );
  await cleanupCharacterizationIsolatedDirectories(directories);
  await assert.rejects(() => stat(directories.rootDirectory), /ENOENT/);
  await assert.rejects(
    () =>
      cleanupCharacterizationIsolatedDirectories({
        rootDirectory: tmpdir(),
        workspaceDirectory: join(tmpdir(), "workspace"),
        homeDirectory: join(tmpdir(), "home"),
        codexHomeDirectory: join(tmpdir(), "codex-home"),
      }),
    /exact temporary layout/,
  );
});

test("builds only the fixed bounded matrix classifications", () => {
  for (const fixture of [
    { pattern: "requested", expected: "requested-skill-only" },
    { pattern: "all", expected: "all-available-skills" },
    { pattern: "none", expected: "no-skill-evidence" },
  ] as const) {
    const report = buildSkillInjectedCharacterizationReport({
      codexVersion: "codex-cli 0.146.0",
      codexAnalyticsExplicitlyAllowed: true,
      observations: observationsForPattern(fixture.pattern),
    });
    assert.equal(report.classification, fixture.expected);
    assert.equal(characterizationReportRequiresFailure(report), false);
  }

  const inconsistent = buildSkillInjectedCharacterizationReport({
    codexVersion: "codex-cli 0.146.0",
    codexAnalyticsExplicitlyAllowed: true,
    observations: [
      observation("neither-requested", []),
      observation("target-requested", [CHARACTERIZATION_SKILLS.target.id], {
        targetArtifactMatched: false,
      }),
      observation("control-requested", [CHARACTERIZATION_SKILLS.control.id]),
    ],
  });
  assert.equal(inconsistent.classification, "inconsistent");
  assert.equal(characterizationReportRequiresFailure(inconsistent), true);

  const processFailure = buildSkillInjectedCharacterizationReport({
    codexVersion: "codex-cli 0.146.0",
    codexAnalyticsExplicitlyAllowed: true,
    observations: [
      observation("neither-requested", []),
      observation("target-requested", [CHARACTERIZATION_SKILLS.target.id], {
        processStatus: "exit-nonzero",
      }),
      observation("control-requested", [CHARACTERIZATION_SKILLS.control.id]),
    ],
  });
  assert.equal(processFailure.classification, "inconsistent");

  const malformedTransportObservation = observation("target-requested", [
    CHARACTERIZATION_SKILLS.target.id,
  ]);
  const malformedTransport = buildSkillInjectedCharacterizationReport({
    codexVersion: "codex-cli 0.146.0",
    codexAnalyticsExplicitlyAllowed: true,
    observations: [
      observation("neither-requested", []),
      {
        ...malformedTransportObservation,
        diagnostics: diagnostics({
          otlpMetricsRequestsReceived: 1,
          successfullyDecodedRequests: 0,
          decodeFailures: 1,
          otlpValidationFailures: 1,
        }),
      },
      observation("control-requested", [CHARACTERIZATION_SKILLS.control.id]),
    ],
  });
  assert.equal(malformedTransport.classification, "inconsistent");
});

test("reports each isolated evidence matrix row without prompts, tokens, paths, or content", () => {
  const report = buildSkillInjectedCharacterizationReport({
    codexVersion: "codex-cli 0.146.0",
    codexAnalyticsExplicitlyAllowed: true,
    observations: observationsForPattern("requested"),
  });
  const serialized = JSON.stringify(report);

  assert.deepEqual(
    report.scenarios.map(({ scenario }) => scenario),
    CHARACTERIZATION_SCENARIO_IDS,
  );
  assert.deepEqual(
    report.scenarios.map(
      ({ targetEvidenceObserved, controlEvidenceObserved }) => [
        targetEvidenceObserved,
        controlEvidenceObserved,
      ],
    ),
    [
      [false, false],
      [true, false],
      [false, true],
    ],
  );
  for (const prohibited of [
    CHARACTERIZATION_SKILLS.target.artifactToken,
    CHARACTERIZATION_SKILLS.control.artifactToken,
    CHARACTERIZATION_SKILLS.target.artifactFileName,
    CHARACTERIZATION_SKILLS.control.artifactFileName,
    CHARACTERIZATION_SCENARIOS[0]?.prompt ?? "PRIVATE_PROMPT",
    "/PRIVATE/CALLER/HOME",
    "PRIVATE_API_KEY",
    "PRIVATE_WORKSPACE_CONTENT",
    CHARACTERIZATION_SKILLS.target.id,
    CHARACTERIZATION_SKILLS.control.id,
  ]) {
    assert.equal(serialized.includes(prohibited), false);
  }
  assert.deepEqual(report.limitations, {
    availabilityClaimed: false,
    skillReadClaimed: false,
    selectionGuaranteeClaimed: false,
    executionGuaranteeClaimed: false,
    instructionComplianceGuaranteeClaimed: false,
  });
  assert.equal(
    report.scenarios.every(
      ({ diagnostics: observedDiagnostics }) =>
        observedDiagnostics.successfullyDecodedRequests === 1,
    ),
    true,
  );
});

test("uses the proven explicit invocation without multi-agent behavior", () => {
  for (const scenario of CHARACTERIZATION_SCENARIOS) {
    const args = buildCodexExecArguments({
      collectorEndpoint: "http://127.0.0.1:4318/v1/metrics",
      prompt: scenario.prompt,
      temporaryRepository: "/synthetic/isolated-workspace",
      enableMultiAgent: false,
      sandboxMode: "workspace-write",
      codexAnalyticsExplicitlyAllowed: true,
    });
    assert.equal(args.includes("workspace-write"), true);
    assert.equal(args.includes("multi_agent"), false);
    assert.equal(args.includes("agents.enabled=true"), false);
    assert.equal(args.at(-1), scenario.prompt);
    assert.equal(args.includes("--ephemeral"), true);
    assert.equal(args.includes("--ignore-user-config"), true);
    assert.equal(args.includes("--ignore-rules"), true);
    assert.equal(args.includes("--strict-config"), true);
  }
});

test("rejects duplicate, missing, or non-allowlisted scenario evidence", () => {
  const requested = observationsForPattern("requested");
  assert.throws(
    () =>
      buildSkillInjectedCharacterizationReport({
        codexVersion: "codex-cli 0.146.0",
        codexAnalyticsExplicitlyAllowed: true,
        observations: [requested[0]!, requested[0]!, requested[2]!],
      }),
    /exactly one isolated observation per scenario/,
  );
  assert.throws(
    () =>
      buildSkillInjectedCharacterizationReport({
        codexVersion: "codex-cli 0.146.0",
        codexAnalyticsExplicitlyAllowed: true,
        observations: [
          requested[0]!,
          {
            ...requested[1]!,
            snapshot: snapshot(["PRIVATE_UNKNOWN_SKILL"]),
          },
          requested[2]!,
        ],
      }),
    /outside its fixed allowlist/,
  );
});

test("fixture files contain only their own fixed behavior", async () => {
  const testDirectory = dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = resolve(testDirectory, "../../../..");
  const fixtureRoot = join(
    repositoryRoot,
    "experiments/codex-cli-integration/fixtures",
  );
  for (const kind of ["target", "control"] as const) {
    const own = CHARACTERIZATION_SKILLS[kind];
    const other =
      CHARACTERIZATION_SKILLS[kind === "target" ? "control" : "target"];
    const contents = await readFile(
      join(fixtureRoot, "skills", own.id, "SKILL.md"),
      "utf8",
    );
    assert.equal(contents.includes(own.artifactToken), true);
    assert.equal(contents.includes(other.artifactToken), false);
    assert.equal(contents.includes("subagent"), false);
    assert.equal(contents.includes("nested"), false);
  }
});
