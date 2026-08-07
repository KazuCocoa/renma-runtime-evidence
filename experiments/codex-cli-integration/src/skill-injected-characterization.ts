import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

import type {
  CodexSkillEvidenceDiagnosticsSnapshot,
  CodexSkillPresenceSnapshot,
} from "../../../src/index.js";
import {
  classifyPipelineDiagnostics,
  CODEX_ANALYTICS_CONSENT_MESSAGE,
  type PipelineClassification,
  type ScenarioDiagnostic,
} from "./integration-config.js";

export const CHARACTERIZATION_EXPERIMENT_ID =
  "skill-injected-selection-boundary-20260807" as const;
const CHARACTERIZATION_TEMPORARY_PREFIX =
  "renma-skill-injected-characterization-";

export const CHARACTERIZATION_SKILLS = {
  target: {
    id: "renma-integration-characterization-target-20260807",
    artifactFileName: "renma-characterization-target-20260807.txt",
    artifactToken: "RENMA_CHARACTERIZATION_TARGET_20260807",
  },
  control: {
    id: "renma-integration-characterization-control-20260807",
    artifactFileName: "renma-characterization-control-20260807.txt",
    artifactToken: "RENMA_CHARACTERIZATION_CONTROL_20260807",
  },
} as const;

export const CHARACTERIZATION_SCENARIO_IDS = [
  "neither-requested",
  "target-requested",
  "control-requested",
] as const;

export type CharacterizationScenarioId =
  (typeof CHARACTERIZATION_SCENARIO_IDS)[number];
export type RequestedSyntheticSkill = "neither" | "target" | "control";
export type CharacterizationClassification =
  | "requested-skill-only"
  | "all-available-skills"
  | "no-skill-evidence"
  | "inconsistent";
export type CharacterizationProcessStatus =
  "completed" | "start-failed" | "timed-out" | "exit-nonzero";

export interface CharacterizationScenarioDefinition {
  readonly id: CharacterizationScenarioId;
  readonly requestedSkill: RequestedSyntheticSkill;
  readonly prompt: string;
}

const scenarioDefinitions: Record<
  CharacterizationScenarioId,
  CharacterizationScenarioDefinition
> = {
  "neither-requested": {
    id: "neither-requested",
    requestedSkill: "neither",
    prompt:
      "Do not use any repository Skill and do not create any file. Return exactly RENMA_CHARACTERIZATION_NO_SKILL_ACK.",
  },
  "target-requested": {
    id: "target-requested",
    requestedSkill: "target",
    prompt: `Use $${CHARACTERIZATION_SKILLS.target.id}. Follow only that synthetic Skill's fixed artifact instruction, then return its fixed acknowledgement.`,
  },
  "control-requested": {
    id: "control-requested",
    requestedSkill: "control",
    prompt: `Use $${CHARACTERIZATION_SKILLS.control.id}. Follow only that synthetic Skill's fixed artifact instruction, then return its fixed acknowledgement.`,
  },
};

export const CHARACTERIZATION_SCENARIOS: readonly CharacterizationScenarioDefinition[] =
  CHARACTERIZATION_SCENARIO_IDS.map(
    (scenarioId) => scenarioDefinitions[scenarioId],
  );

export const CHARACTERIZATION_EXECUTION_ENVIRONMENT_VARIABLES = [
  "PATH",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
] as const;

export interface CharacterizationRunnerArguments {
  readonly codexAnalyticsExplicitlyAllowed: true;
  readonly outputPath?: string;
}

export interface CharacterizationIsolatedDirectories {
  readonly rootDirectory: string;
  readonly workspaceDirectory: string;
  readonly homeDirectory: string;
  readonly codexHomeDirectory: string;
}

export interface CharacterizationFixtureContents {
  readonly target: string;
  readonly control: string;
}

export interface CharacterizationScenarioObservation {
  readonly scenario: CharacterizationScenarioId;
  readonly processStatus: CharacterizationProcessStatus;
  readonly targetArtifactMatched: boolean;
  readonly controlArtifactMatched: boolean;
  readonly snapshot: CodexSkillPresenceSnapshot;
  readonly diagnostics: CodexSkillEvidenceDiagnosticsSnapshot;
}

export interface CharacterizationScenarioResult {
  readonly scenario: CharacterizationScenarioId;
  readonly requestedSkill: RequestedSyntheticSkill;
  readonly processStatus: CharacterizationProcessStatus;
  readonly targetArtifactMatched: boolean;
  readonly controlArtifactMatched: boolean;
  readonly targetEvidenceObserved: boolean;
  readonly controlEvidenceObserved: boolean;
  readonly unrecognizedSkillEvidenceObserved: boolean;
  readonly diagnostics: CodexSkillEvidenceDiagnosticsSnapshot;
  readonly pipelineClassification: PipelineClassification;
  readonly classification: CharacterizationClassification;
}

export interface SkillInjectedCharacterizationReport {
  readonly schemaVersion: 1;
  readonly provider: "codex";
  readonly experiment: typeof CHARACTERIZATION_EXPERIMENT_ID;
  readonly codexVersion: string;
  readonly exportedMetric: "codex.skill.injected";
  readonly authenticationIsolationMode: "api-key";
  readonly codexAnalyticsExplicitlyAllowed: true;
  readonly collectorSemantics: "skill-injection-presence";
  readonly scenarios: readonly CharacterizationScenarioResult[];
  readonly classification: CharacterizationClassification;
  readonly limitations: {
    readonly availabilityClaimed: false;
    readonly skillReadClaimed: false;
    readonly selectionGuaranteeClaimed: false;
    readonly executionGuaranteeClaimed: false;
    readonly instructionComplianceGuaranteeClaimed: false;
  };
}

function isStrictDescendant(parent: string, candidate: string): boolean {
  const relativePath = relative(parent, candidate);
  return (
    relativePath.length > 0 &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  );
}

function assertIsolatedDirectoryPaths(
  directories: CharacterizationIsolatedDirectories,
): void {
  const containedDirectories = [
    directories.workspaceDirectory,
    directories.homeDirectory,
    directories.codexHomeDirectory,
  ];
  if (
    !isAbsolute(directories.rootDirectory) ||
    containedDirectories.some((directory) => !isAbsolute(directory))
  ) {
    throw new Error("Characterization directories must use absolute paths");
  }
  if (
    !isStrictDescendant(
      resolve(tmpdir()),
      resolve(directories.rootDirectory),
    ) ||
    !basename(directories.rootDirectory).startsWith(
      CHARACTERIZATION_TEMPORARY_PREFIX,
    ) ||
    resolve(directories.workspaceDirectory) !==
      join(resolve(directories.rootDirectory), "workspace") ||
    resolve(directories.homeDirectory) !==
      join(resolve(directories.rootDirectory), "home") ||
    resolve(directories.codexHomeDirectory) !==
      join(resolve(directories.rootDirectory), "codex-home")
  ) {
    throw new Error(
      "Characterization isolation paths must use the exact temporary layout",
    );
  }
  if (
    containedDirectories.some(
      (directory) => !isStrictDescendant(directories.rootDirectory, directory),
    )
  ) {
    throw new Error(
      "Characterization workspace and homes must be inside one scenario root",
    );
  }
  if (new Set(containedDirectories).size !== containedDirectories.length) {
    throw new Error("Characterization workspace and homes must be distinct");
  }
}

export function parseCharacterizationRunnerArguments(
  args: readonly string[],
): CharacterizationRunnerArguments {
  let codexAnalyticsExplicitlyAllowed = false;
  let outputPath: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--allow-codex-analytics") {
      if (codexAnalyticsExplicitlyAllowed) {
        throw new Error(
          "Characterization argument error: duplicate --allow-codex-analytics",
        );
      }
      codexAnalyticsExplicitlyAllowed = true;
    } else if (argument === "--output") {
      if (outputPath !== undefined) {
        throw new Error("Characterization argument error: duplicate --output");
      }
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(
          "Characterization argument error: --output requires a path",
        );
      }
      outputPath = resolve(value);
      index += 1;
    } else {
      throw new Error("Characterization argument error: unknown option");
    }
  }

  if (!codexAnalyticsExplicitlyAllowed) {
    throw new Error(CODEX_ANALYTICS_CONSENT_MESSAGE);
  }

  const result: {
    codexAnalyticsExplicitlyAllowed: true;
    outputPath?: string;
  } = { codexAnalyticsExplicitlyAllowed: true };
  if (outputPath !== undefined) {
    result.outputPath = outputPath;
  }
  return result;
}

export function buildCharacterizationChildEnvironment(
  sourceEnvironment: Readonly<NodeJS.ProcessEnv>,
  directories: CharacterizationIsolatedDirectories,
): NodeJS.ProcessEnv {
  assertIsolatedDirectoryPaths(directories);
  const apiKey = sourceEnvironment.CODEX_API_KEY;
  if (!apiKey) {
    throw new Error(
      "The isolated characterization requires CODEX_API_KEY and never reuses caller HOME or CODEX_HOME",
    );
  }
  const childEnvironment: NodeJS.ProcessEnv = {};
  for (const variableName of CHARACTERIZATION_EXECUTION_ENVIRONMENT_VARIABLES) {
    const value = sourceEnvironment[variableName];
    if (value !== undefined) {
      childEnvironment[variableName] = value;
    }
  }
  childEnvironment.HOME = directories.homeDirectory;
  childEnvironment.CODEX_HOME = directories.codexHomeDirectory;
  childEnvironment.CODEX_API_KEY = apiKey;
  return childEnvironment;
}

export async function createCharacterizationIsolatedDirectories(
  parentDirectory = tmpdir(),
): Promise<CharacterizationIsolatedDirectories> {
  const rootDirectory = await mkdtemp(
    join(parentDirectory, CHARACTERIZATION_TEMPORARY_PREFIX),
  );
  const directories: CharacterizationIsolatedDirectories = {
    rootDirectory,
    workspaceDirectory: join(rootDirectory, "workspace"),
    homeDirectory: join(rootDirectory, "home"),
    codexHomeDirectory: join(rootDirectory, "codex-home"),
  };
  try {
    await Promise.all(
      [
        directories.workspaceDirectory,
        directories.homeDirectory,
        directories.codexHomeDirectory,
      ].map((directory) => mkdir(directory, { mode: 0o700 })),
    );
    return directories;
  } catch (error) {
    await rm(rootDirectory, { recursive: true, force: true });
    throw error;
  }
}

export async function preflightCharacterizationIsolation(
  childEnvironment: Readonly<NodeJS.ProcessEnv>,
  directories: CharacterizationIsolatedDirectories,
): Promise<void> {
  assertIsolatedDirectoryPaths(directories);
  if (!childEnvironment.PATH || !childEnvironment.CODEX_API_KEY) {
    throw new Error(
      "The isolated characterization environment requires PATH and CODEX_API_KEY",
    );
  }
  if (
    childEnvironment.HOME !== directories.homeDirectory ||
    childEnvironment.CODEX_HOME !== directories.codexHomeDirectory
  ) {
    throw new Error(
      "Characterization HOME and CODEX_HOME must match the scenario isolation root",
    );
  }
  const locations = [
    directories.workspaceDirectory,
    directories.homeDirectory,
    directories.codexHomeDirectory,
  ];
  const [locationStats, workspaceEntries, homeEntries, codexHomeEntries] =
    await Promise.all([
      Promise.all(locations.map((location) => stat(location))),
      readdir(directories.workspaceDirectory),
      readdir(directories.homeDirectory),
      readdir(directories.codexHomeDirectory),
    ]);
  if (locationStats.some((locationStat) => !locationStat.isDirectory())) {
    throw new Error(
      "Every characterization isolation location must be a directory",
    );
  }
  if (
    workspaceEntries.length !== 0 ||
    homeEntries.length !== 0 ||
    codexHomeEntries.length !== 0
  ) {
    throw new Error("Characterization workspace and homes must start empty");
  }
}

export async function cleanupCharacterizationIsolatedDirectories(
  directories: CharacterizationIsolatedDirectories,
): Promise<void> {
  assertIsolatedDirectoryPaths(directories);
  await rm(directories.rootDirectory, { recursive: true, force: true });
}

export async function loadCharacterizationFixtureContents(
  fixtureRoot: string,
): Promise<CharacterizationFixtureContents> {
  const entries = await Promise.all(
    (["target", "control"] as const).map(async (kind) => {
      const fixture = CHARACTERIZATION_SKILLS[kind];
      const contents = await readFile(
        join(fixtureRoot, "skills", fixture.id, "SKILL.md"),
        "utf8",
      );
      if (
        !contents.includes(`\nname: ${fixture.id}\n`) ||
        !contents.includes(fixture.artifactFileName) ||
        !contents.includes(fixture.artifactToken) ||
        !/synthetic runtime-evidence integration fixture/iu.test(contents)
      ) {
        throw new Error(
          "A characterization Skill fixture is not the expected fixed synthetic fixture",
        );
      }
      return [kind, contents] as const;
    }),
  );
  return Object.fromEntries(
    entries,
  ) as unknown as CharacterizationFixtureContents;
}

export async function fixedArtifactMatches(
  workspaceDirectory: string,
  kind: keyof typeof CHARACTERIZATION_SKILLS,
): Promise<boolean> {
  const fixture = CHARACTERIZATION_SKILLS[kind];
  const artifactPath = join(workspaceDirectory, fixture.artifactFileName);
  try {
    const artifactStat = await lstat(artifactPath);
    if (
      !artifactStat.isFile() ||
      artifactStat.size !== Buffer.byteLength(fixture.artifactToken, "utf8")
    ) {
      return false;
    }
    const contents = await readFile(artifactPath, "utf8");
    return contents === fixture.artifactToken;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw new Error("Unable to validate a fixed characterization artifact");
  }
}

function expectedArtifactState(
  requestedSkill: RequestedSyntheticSkill,
): readonly [target: boolean, control: boolean] {
  return [requestedSkill === "target", requestedSkill === "control"];
}

function observedEvidenceState(
  snapshot: CodexSkillPresenceSnapshot,
): readonly [target: boolean, control: boolean] {
  if (
    snapshot.schemaVersion !== 1 ||
    snapshot.provider !== "codex" ||
    snapshot.signal !== "skill-injected" ||
    snapshot.observationScope !== "collector-lifetime"
  ) {
    throw new Error(
      "Characterization collector returned unsupported evidence semantics",
    );
  }
  const allowedSkills: ReadonlySet<string> = new Set(
    Object.values(CHARACTERIZATION_SKILLS).map(({ id }) => id),
  );
  if (snapshot.injectedSkills.some((skill) => !allowedSkills.has(skill))) {
    throw new Error(
      "Characterization collector returned a Skill outside its fixed allowlist",
    );
  }
  return [
    snapshot.injectedSkills.includes(CHARACTERIZATION_SKILLS.target.id),
    snapshot.injectedSkills.includes(CHARACTERIZATION_SKILLS.control.id),
  ];
}

function classifyScenario(options: {
  readonly definition: CharacterizationScenarioDefinition;
  readonly processStatus: CharacterizationProcessStatus;
  readonly targetArtifactMatched: boolean;
  readonly controlArtifactMatched: boolean;
  readonly targetEvidenceObserved: boolean;
  readonly controlEvidenceObserved: boolean;
  readonly unrecognizedSkillEvidenceObserved: boolean;
  readonly diagnostics: CodexSkillEvidenceDiagnosticsSnapshot;
  readonly pipelineClassification: PipelineClassification;
}): CharacterizationClassification {
  const [expectedTargetArtifact, expectedControlArtifact] =
    expectedArtifactState(options.definition.requestedSkill);
  if (
    options.processStatus !== "completed" ||
    options.targetArtifactMatched !== expectedTargetArtifact ||
    options.controlArtifactMatched !== expectedControlArtifact ||
    options.unrecognizedSkillEvidenceObserved ||
    options.diagnostics.decodeFailures !== 0 ||
    options.diagnostics.unknownOrMissingSkillLabelDataPoints !== 0 ||
    options.diagnostics.counterSaturationObserved ||
    (options.pipelineClassification !== "accepted-skill-evidence" &&
      options.pipelineClassification !== "non-target-metric-datapoints-only")
  ) {
    return "inconsistent";
  }
  if (options.targetEvidenceObserved && options.controlEvidenceObserved) {
    return "all-available-skills";
  }
  if (!options.targetEvidenceObserved && !options.controlEvidenceObserved) {
    return "no-skill-evidence";
  }
  const expectedTargetEvidence = options.definition.requestedSkill === "target";
  const expectedControlEvidence =
    options.definition.requestedSkill === "control";
  return options.targetEvidenceObserved === expectedTargetEvidence &&
    options.controlEvidenceObserved === expectedControlEvidence
    ? "requested-skill-only"
    : "inconsistent";
}

export function buildCharacterizationScenarioResult(
  observation: CharacterizationScenarioObservation,
): CharacterizationScenarioResult {
  const definition = scenarioDefinitions[observation.scenario];
  const [targetEvidenceObserved, controlEvidenceObserved] =
    observedEvidenceState(observation.snapshot);
  const pipelineClassification = classifyPipelineDiagnostics(
    observation.diagnostics,
  );
  const classification = classifyScenario({
    definition,
    processStatus: observation.processStatus,
    targetArtifactMatched: observation.targetArtifactMatched,
    controlArtifactMatched: observation.controlArtifactMatched,
    targetEvidenceObserved,
    controlEvidenceObserved,
    unrecognizedSkillEvidenceObserved:
      observation.snapshot.unrecognizedSkillObserved,
    diagnostics: observation.diagnostics,
    pipelineClassification,
  });
  return {
    scenario: observation.scenario,
    requestedSkill: definition.requestedSkill,
    processStatus: observation.processStatus,
    targetArtifactMatched: observation.targetArtifactMatched,
    controlArtifactMatched: observation.controlArtifactMatched,
    targetEvidenceObserved,
    controlEvidenceObserved,
    unrecognizedSkillEvidenceObserved:
      observation.snapshot.unrecognizedSkillObserved,
    diagnostics: observation.diagnostics,
    pipelineClassification,
    classification,
  };
}

function evidencePatternMatches(
  result: CharacterizationScenarioResult,
  targetEvidenceObserved: boolean,
  controlEvidenceObserved: boolean,
): boolean {
  return (
    result.targetEvidenceObserved === targetEvidenceObserved &&
    result.controlEvidenceObserved === controlEvidenceObserved
  );
}

function classifyMatrix(
  results: readonly CharacterizationScenarioResult[],
): CharacterizationClassification {
  if (
    results.length !== CHARACTERIZATION_SCENARIO_IDS.length ||
    results.some((result) => result.classification === "inconsistent")
  ) {
    return "inconsistent";
  }
  if (results.every((result) => evidencePatternMatches(result, true, true))) {
    return "all-available-skills";
  }
  if (results.every((result) => evidencePatternMatches(result, false, false))) {
    return "no-skill-evidence";
  }
  const resultByScenario = new Map(
    results.map((result) => [result.scenario, result]),
  );
  const neither = resultByScenario.get("neither-requested");
  const target = resultByScenario.get("target-requested");
  const control = resultByScenario.get("control-requested");
  if (
    neither &&
    target &&
    control &&
    evidencePatternMatches(neither, false, false) &&
    evidencePatternMatches(target, true, false) &&
    evidencePatternMatches(control, false, true)
  ) {
    return "requested-skill-only";
  }
  return "inconsistent";
}

export function buildSkillInjectedCharacterizationReport(options: {
  readonly codexVersion: string;
  readonly codexAnalyticsExplicitlyAllowed: true;
  readonly observations: readonly CharacterizationScenarioObservation[];
}): SkillInjectedCharacterizationReport {
  if (options.codexAnalyticsExplicitlyAllowed !== true) {
    throw new Error(CODEX_ANALYTICS_CONSENT_MESSAGE);
  }
  const observationsByScenario = new Map(
    options.observations.map((observation) => [
      observation.scenario,
      observation,
    ]),
  );
  if (
    options.observations.length !== CHARACTERIZATION_SCENARIO_IDS.length ||
    observationsByScenario.size !== CHARACTERIZATION_SCENARIO_IDS.length
  ) {
    throw new Error(
      "Characterization requires exactly one isolated observation per scenario",
    );
  }
  const scenarios = CHARACTERIZATION_SCENARIO_IDS.map((scenarioId) => {
    const observation = observationsByScenario.get(scenarioId);
    if (!observation) {
      throw new Error(
        "Characterization requires exactly one isolated observation per scenario",
      );
    }
    return buildCharacterizationScenarioResult(observation);
  });
  return {
    schemaVersion: 1,
    provider: "codex",
    experiment: CHARACTERIZATION_EXPERIMENT_ID,
    codexVersion: options.codexVersion,
    exportedMetric: "codex.skill.injected",
    authenticationIsolationMode: "api-key",
    codexAnalyticsExplicitlyAllowed: true,
    collectorSemantics: "skill-injection-presence",
    scenarios,
    classification: classifyMatrix(scenarios),
    limitations: {
      availabilityClaimed: false,
      skillReadClaimed: false,
      selectionGuaranteeClaimed: false,
      executionGuaranteeClaimed: false,
      instructionComplianceGuaranteeClaimed: false,
    },
  };
}

export function characterizationReportRequiresFailure(
  report: SkillInjectedCharacterizationReport,
): boolean {
  return report.classification === "inconsistent";
}

export function processStatusFromDiagnostic(
  diagnostic: ScenarioDiagnostic | undefined,
): CharacterizationProcessStatus {
  if (diagnostic === "process-start-failed") {
    return "start-failed";
  }
  if (diagnostic === "process-timeout") {
    return "timed-out";
  }
  if (diagnostic === "process-exit-nonzero") {
    return "exit-nonzero";
  }
  return "completed";
}
