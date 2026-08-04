import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { SkillInjectionObservation } from "./allowlist.js";
import { SYNTHETIC_SKILL_NAME } from "./allowlist.js";
import { startLocalCollector } from "./collector.js";

interface RunSummary {
  experimentRunId: string;
  codexExitCode: number | null;
  targetMetricObserved: boolean;
  observations: SkillInjectionObservation[];
}

interface ExperimentReport {
  experimentDate: string;
  codexVersion: string;
  provider: "codex";
  targetExportedMetric: "codex.skill.injected";
  syntheticSkill: typeof SYNTHETIC_SKILL_NAME;
  runsRequested: number;
  runs: RunSummary[];
}

const sourceDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(sourceDirectory, "../../../..");
const fixturePath = join(
  repositoryRoot,
  "experiments/codex-skill-injected/fixtures",
  SYNTHETIC_SKILL_NAME,
  "SKILL.md",
);
const defaultOutputPath = join(
  repositoryRoot,
  "experiments/codex-skill-injected/.local/experiment-report.json",
);

function runProcess(
  command: string,
  args: string[],
  options: { cwd?: string; captureStdout?: boolean } = {},
): Promise<{ exitCode: number | null; stdout: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: ["ignore", options.captureStdout ? "pipe" : "ignore", "ignore"],
    });
    let stdout = "";

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.once("error", reject);
    child.once("close", (exitCode) => resolvePromise({ exitCode, stdout }));
  });
}

async function readCodexVersion(): Promise<string> {
  const result = await runProcess("codex", ["--version"], {
    captureStdout: true,
  });
  const version = result.stdout.trim();
  if (result.exitCode !== 0 || !/^codex-cli \d+\.\d+\.\d+/.test(version)) {
    throw new Error("Unable to determine the installed Codex version");
  }
  return version;
}

function readArguments(): { outputPath: string; runs: number } {
  let outputPath = defaultOutputPath;
  let runs = 3;

  for (let index = 2; index < process.argv.length; index += 1) {
    const argument = process.argv[index];
    if (argument === "--runs") {
      const value = Number(process.argv[index + 1]);
      if (!Number.isInteger(value) || value < 1 || value > 10) {
        throw new Error("--runs must be an integer from 1 to 10");
      }
      runs = value;
      index += 1;
    } else if (argument === "--output") {
      const value = process.argv[index + 1];
      if (!value) {
        throw new Error("--output requires a path");
      }
      outputPath = resolve(value);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return { outputPath, runs };
}

async function runOnce(
  codexVersion: string,
  fixtureContents: string,
): Promise<RunSummary> {
  const experimentRunId = randomUUID();
  const temporaryWorkspace = await mkdtemp(
    join(tmpdir(), "renma-runtime-evidence-codex-"),
  );
  const skillDirectory = join(
    temporaryWorkspace,
    ".agents/skills",
    SYNTHETIC_SKILL_NAME,
  );
  const collector = await startLocalCollector({
    codexVersion,
    experimentRunId,
  });

  try {
    await mkdir(skillDirectory, { recursive: true });
    await writeFile(join(skillDirectory, "SKILL.md"), fixtureContents, "utf8");

    const metricsExporter = `{ otlp-http = { endpoint = "${collector.endpoint}", protocol = "json" } }`;
    const prompt = `Use $${SYNTHETIC_SKILL_NAME}. Return only the synthetic acknowledgement required by that Skill.`;
    const result = await runProcess(
      "codex",
      [
        "exec",
        "--ephemeral",
        "--ignore-user-config",
        "--skip-git-repo-check",
        "-C",
        temporaryWorkspace,
        "-c",
        'sandbox_mode="read-only"',
        "-c",
        'approval_policy="never"',
        "-c",
        "otel.log_user_prompt=false",
        "-c",
        'otel.exporter="none"',
        "-c",
        'otel.trace_exporter="none"',
        "-c",
        `otel.metrics_exporter=${metricsExporter}`,
        prompt,
      ],
      { cwd: temporaryWorkspace },
    );

    return {
      experimentRunId,
      codexExitCode: result.exitCode,
      targetMetricObserved: collector.observations.length > 0,
      observations: [...collector.observations],
    };
  } finally {
    await collector.close();
    await rm(temporaryWorkspace, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const { outputPath, runs } = readArguments();
  const [codexVersion, fixtureContents] = await Promise.all([
    readCodexVersion(),
    readFile(fixturePath, "utf8"),
  ]);
  const runSummaries: RunSummary[] = [];

  for (let index = 0; index < runs; index += 1) {
    runSummaries.push(await runOnce(codexVersion, fixtureContents));
  }

  const report: ExperimentReport = {
    experimentDate: new Date().toISOString().slice(0, 10),
    codexVersion,
    provider: "codex",
    targetExportedMetric: "codex.skill.injected",
    syntheticSkill: SYNTHETIC_SKILL_NAME,
    runsRequested: runs,
    runs: runSummaries,
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const observedRuns = runSummaries.filter(
    (run) => run.targetMetricObserved,
  ).length;
  process.stdout.write(
    `${JSON.stringify({ ...report, runs: undefined, observedRuns })}\n`,
  );
}

await main();
