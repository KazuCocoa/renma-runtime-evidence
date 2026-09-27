import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  createCodexSkillEvidenceCollector,
  type CodexSkillEvidenceCollector,
} from "../../../src/index.js";
import {
  createCharacterizationIsolatedDirectories,
  cleanupCharacterizationIsolatedDirectories,
  linkCharacterizationChatgptLogin,
} from "../../codex-cli-integration/src/skill-injected-characterization.js";
import { classifyPipelineDiagnostics } from "../../codex-cli-integration/src/integration-config.js";
import {
  LISTING_FIXTURE_NAME,
  listingEnvironment,
  listingServerArguments,
  reduceListingResult,
} from "../../codex-listing-freshness/src/listing.js";
import {
  ARTIFACT,
  artifactRevision,
  completedTurn,
  deployment,
  ephemeralThreadId,
  fixture,
  object,
  requireOptIn,
  SCENARIOS,
  startedTurnId,
  type Revision,
  type TurnStatus,
} from "./contract.js";

import {
  BARRIER_TOOL,
  BARRIER_SPEC,
  barrierFixture,
  barrierDeployment,
  reduceBarrierRequest,
  reduceBarrierCompletion,
  type BarrierRouting,
} from "./barrier.js";

import { bindRuntimeOtelProjection } from "./runtime-otel.js";

type Mode = "between-turn" | "direct-tool" | "skill-midturn";

const RPC_TIMEOUT = 15_000;
const TURN_TIMEOUT = 180_000;
let stage:
  | "setup"
  | "initialize"
  | "listing"
  | "thread-start"
  | "turn-start"
  | "turn-completion"
  | "shutdown" = "setup";

function signal(child: ChildProcess, value: NodeJS.Signals): void {
  if (!child.pid) return;
  try {
    if (process.platform === "win32") child.kill(value);
    else process.kill(-child.pid, value);
  } catch {
    /* Already exited. */
  }
}

async function run(mode: Mode, emitRuntimeOtel = false) {
  stage = "setup";
  const directories = await createCharacterizationIsolatedDirectories();
  let child: ChildProcess | undefined;
  let closed: Promise<void> | undefined;
  let collector: CodexSkillEvidenceCollector | undefined;
  let aborted = false;
  let stopped = false;
  let barrierRouting: BarrierRouting | undefined;
  let barrierServing = false;
  let barrierHandled = false;
  let mutationVerified = false;
  let toolCompletion: "success" | "failure" | "unsupported" | "not-observed" =
    "not-observed";
  let barrierOperation: Promise<void> | undefined;
  let serviceBarrier: () => void = () => {};

  let pending:
    | {
        id: number;
        reduce: (value: unknown) => unknown;
        resolve: (value: unknown) => void;
        reject: () => void;
        timer: NodeJS.Timeout;
      }
    | undefined;
  let activeTurn:
    | {
        threadId: string;
        turnId?: string;
        early: { id: string; status: TurnStatus } | undefined;
        status?: TurnStatus;
        done: (() => void) | undefined;
        timer: NodeJS.Timeout;
      }
    | undefined;
  const abort = () => {
    aborted = true;
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject();
      pending = undefined;
    }
    if (activeTurn) {
      activeTurn.status = "unsupported";
      activeTurn.done?.();
    }
    if (child) signal(child, "SIGTERM");
  };
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  const shutdown = async () => {
    if (stopped) return;
    stopped = true;
    if (child && closed) {
      signal(child, "SIGTERM");
      const timer = setTimeout(() => signal(child!, "SIGKILL"), 1_000);
      await closed;
      clearTimeout(timer);
    }
  };
  try {
    const workspace = await realpath(directories.workspaceDirectory);
    const skillDirectory = join(
      workspace,
      ".agents/skills",
      LISTING_FIXTURE_NAME,
    );
    const skillPath = join(skillDirectory, "SKILL.md");
    await mkdir(skillDirectory, { recursive: true, mode: 0o700 });
    await linkCharacterizationChatgptLogin(
      directories,
      process.env.CODEX_HOME || join(homedir(), ".codex"),
    );
    const environment = listingEnvironment(
      process.env,
      directories.homeDirectory,
      directories.codexHomeDirectory,
      directories.rootDirectory,
    );
    const versionResult = spawnSync("codex", ["--version"], {
      cwd: workspace,
      env: environment,
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 256,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const version = versionResult.stdout?.trim();
    if (
      versionResult.status !== 0 ||
      !/^codex-cli \d+\.\d+\.\d+$/u.test(version)
    )
      throw new Error("Unsupported CLI");
    const login = spawnSync(
      "codex",
      ["-c", 'cli_auth_credentials_store="file"', "login", "status"],
      {
        cwd: workspace,
        env: environment,
        encoding: "utf8",
        timeout: 10_000,
        maxBuffer: 4096,
      },
    );
    if (
      login.status !== 0 ||
      !/^Logged in using ChatGPT\s*$/im.test(
        (login.stdout ?? "") + "\n" + (login.stderr ?? ""),
      )
    )
      throw new Error("ChatGPT login unavailable");
    const fixtureBytes = mode === "between-turn" ? fixture : barrierFixture;
    const snapshotFor =
      mode === "between-turn" ? deployment : barrierDeployment;
    const writeRevision = async (revision: Revision) => {
      await writeFile(skillPath, fixtureBytes(revision), { mode: 0o600 });
      if (
        !(await readFile(skillPath)).equals(Buffer.from(fixtureBytes(revision)))
      )
        throw new Error("Fixture deployment failed");
      return snapshotFor(revision);
    };
    const snapshotA = await writeRevision("a");
    const runtimeProjection = emitRuntimeOtel
      ? bindRuntimeOtelProjection(snapshotA, "real-cli")
      : undefined;
    collector = await createCodexSkillEvidenceCollector({
      allowedSkills: [LISTING_FIXTURE_NAME],
    });
    const args = [
      ...listingServerArguments(),
      "-c",
      "analytics.enabled=true",
      "-c",
      `otel.metrics_exporter={ otlp-http = { endpoint = "${collector.endpoint}", protocol = "json" } }`,
      "-c",
      "features.multi_agent=false",
      "-c",
      "project_doc_max_bytes=0",
    ];
    child = spawn("codex", args, {
      cwd: workspace,
      env: environment,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "ignore"],
    });
    closed = new Promise<void>((done) =>
      child!.once("close", () => {
        abort();
        done();
      }),
    );
    child.on("error", abort);
    child.stdin!.on("error", abort);
    serviceBarrier = () => {
      if (!barrierRouting || !activeTurn?.turnId || barrierServing) return;
      if (barrierRouting.turnId !== activeTurn.turnId) {
        abort();
        return;
      }
      barrierServing = true;
      const routing = barrierRouting;
      barrierOperation = (async () => {
        if (mode === "skill-midturn") {
          await writeRevision("b");
          mutationVerified = true;
        }
        if (aborted) return;
        barrierHandled = true;
        child!.stdin!.write(
          `${JSON.stringify({ id: routing.requestId, result: { contentItems: [{ type: "inputText", text: "Synthetic barrier completed." }], success: true } })}\n`,
        );
      })().catch(abort);
    };
    let buffer = "";
    let bytes = 0;
    child.stdout!.on("data", (chunk: Buffer) => {
      if (aborted) return;
      bytes += chunk.length;
      if (
        bytes > 8 * 1024 * 1024 ||
        Buffer.byteLength(buffer) + chunk.length > 1024 * 1024
      ) {
        buffer = "";
        abort();
        return;
      }
      buffer += chunk.toString("utf8");
      let boundary: number;
      while ((boundary = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 1);
        try {
          const message = object(JSON.parse(line));
          if (!message) throw new Error("Unsupported RPC");
          if (
            pending &&
            message.id === pending.id &&
            message.method === undefined
          ) {
            if (message.error !== undefined || message.result === undefined)
              throw new Error("RPC failed");
            const reduced = pending.reduce(message.result);
            clearTimeout(pending.timer);
            const resolve = pending.resolve;
            pending = undefined;
            resolve(reduced);
          } else if (message.id !== undefined && message.method !== undefined) {
            if (mode === "between-turn" || !activeTurn || barrierRouting)
              throw new Error("Unexpected server request");
            barrierRouting = reduceBarrierRequest(message, activeTurn.threadId);
            serviceBarrier();
          } else if (barrierRouting && message.method === "item/completed") {
            const completion = reduceBarrierCompletion(message, barrierRouting);
            if (completion !== undefined) toolCompletion = completion;
          } else if (activeTurn && message.method === "turn/completed") {
            const params = object(message.params);
            const turn = object(params?.turn);
            if (
              params?.threadId === activeTurn.threadId &&
              typeof turn?.id === "string"
            ) {
              const status = completedTurn(
                message,
                activeTurn.threadId,
                turn.id,
              );
              if (status !== undefined) {
                if (activeTurn.turnId === turn.id) {
                  activeTurn.status = status;
                  activeTurn.done?.();
                } else if (!activeTurn.turnId && turn.id.length <= 256)
                  activeTurn.early = { id: turn.id, status };
              }
            }
          }
          // All other payloads, including text, reasoning and tool content, are discarded.
        } catch {
          buffer = "";
          abort();
          return;
        }
      }
    });
    let nextId = 0;
    function request<T>(
      method: string,
      params: unknown,
      reduce: (value: unknown) => T,
    ): Promise<T> {
      return new Promise((resolve, reject) => {
        if (aborted || pending) {
          reject(new Error("RPC unavailable"));
          return;
        }
        const id = nextId++;
        pending = {
          id,
          reduce,
          resolve: (value) => resolve(value as T),
          reject: () => reject(new Error("RPC unavailable")),
          timer: setTimeout(abort, RPC_TIMEOUT),
        };
        child!.stdin!.write(`${JSON.stringify({ id, method, params })}\n`);
      });
    }
    stage = "initialize";
    await request(
      "initialize",
      {
        clientInfo: { name: "renma_model_freshness_fixture", version: "1" },
        ...(mode === "between-turn"
          ? {}
          : { capabilities: { experimentalApi: true } }),
      },
      () => null,
    );
    child.stdin!.write(
      `${JSON.stringify({ method: "initialized", params: {} })}\n`,
    );
    const listing = (forceReload: boolean) => {
      stage = "listing";
      return request(
        "skills/list",
        { cwds: [workspace], forceReload },
        (value) => reduceListingResult(value, workspace, skillPath),
      );
    };
    const startThread = () => {
      stage = "thread-start";
      return request(
        "thread/start",
        {
          cwd: workspace,
          ephemeral: true,
          approvalPolicy: "never",
          sandbox: "workspace-write",
          experimentalRawEvents: false,
          ...(mode === "between-turn" ? {} : { dynamicTools: [BARRIER_SPEC] }),
        },
        ephemeralThreadId,
      );
    };
    const turn = async (threadId: string) => {
      await rm(join(workspace, ARTIFACT), { force: true });
      activeTurn = {
        threadId,
        early: undefined,
        done: undefined,
        timer: setTimeout(abort, TURN_TIMEOUT),
      };
      try {
        stage = "turn-start";
        const id = await request(
          "turn/start",
          {
            threadId,
            input:
              mode === "direct-tool"
                ? [
                    {
                      type: "text",
                      text: `Call ${BARRIER_TOOL} exactly once with an empty object. Do not use any Skill, read files, or create files. Return a short acknowledgement.`,
                    },
                  ]
                : [
                    {
                      type: "text",
                      text: `$${LISTING_FIXTURE_NAME} Follow the synthetic Skill's fixed artifact instruction for this turn.`,
                    },
                    {
                      type: "skill",
                      name: LISTING_FIXTURE_NAME,
                      path: skillPath,
                    },
                  ],
          },
          startedTurnId,
        );
        stage = "turn-completion";
        activeTurn.turnId = id;
        serviceBarrier();
        if (activeTurn.early?.id === id)
          activeTurn.status = activeTurn.early.status;
        if (activeTurn.status === undefined)
          await new Promise<void>((done) => {
            activeTurn!.done = done;
          });
        const status = activeTurn.status ?? "unsupported";
        if (aborted || status !== "completed")
          throw new Error("Model turn unavailable");
        return { status, artifactRevision: await artifactRevision(workspace) };
      } finally {
        if (activeTurn) clearTimeout(activeTurn.timer);
        activeTurn = undefined;
      }
    };
    const observations = [];
    const initialListing = await listing(false);
    if (
      emitRuntimeOtel &&
      (initialListing.fixtureEntries !== "one" ||
        !initialListing.expectedPathMatched ||
        initialListing.listingErrorsObserved)
    )
      throw new Error(
        "Runtime projection requires one confirmed fixture listing",
      );
    const originalThread = await startThread();
    if (mode !== "between-turn") {
      const modelTurn = await turn(originalThread);
      await barrierOperation;
      const finalListing = await listing(true);
      stage = "shutdown";
      await shutdown();
      const snapshot = await collector.closeAndSnapshot();
      const diagnostics = collector.diagnosticsSnapshot();
      return {
        schemaVersion: "renma.codex-barrier-row.v1",
        ...(runtimeProjection
          ? { runtimeOtel: runtimeProjection.project(snapshot) }
          : {}),
        codexVersion: version,
        scenario: mode,
        authentication: "chatgpt-file-linked",
        codexAnalyticsExplicitlyAllowed: true,
        initialDeployment: snapshotA,
        finalDeployment: mutationVerified ? barrierDeployment("b") : snapshotA,
        initialListing,
        finalListing,
        modelTurn,
        providerTool: {
          requestObserved: barrierRouting !== undefined,
          completion: toolCompletion,
        },
        wrapperBarrier: {
          handled: barrierHandled,
          replacementVerifiedBeforeReply: mutationVerified,
        },
        providerPresence: {
          scope: "collector-lifetime-one-model-turn",
          knownFixtureObserved:
            snapshot.injectedSkills.includes(LISTING_FIXTURE_NAME),
          unknownSkillObserved: snapshot.unrecognizedSkillObserved,
          pipeline: classifyPipelineDiagnostics(diagnostics),
        },
        limitations: {
          skillCausedToolCall: "unsupported",
          injectedRevision: "unsupported",
          artifactProvenance: "experiment-wrapper",
          remoteCacheBehavior: "not-tested",
          generalExecutionGuarantee: false,
        },
      };
    }
    observations.push({
      scenario: SCENARIOS[0],
      deployment: snapshotA,
      listing: initialListing,
      modelTurn: await turn(originalThread),
    });
    const snapshotB = await writeRevision("b");
    observations.push({
      scenario: SCENARIOS[1],
      deployment: snapshotB,
      listing: await listing(false),
      modelTurn: await turn(originalThread),
    });
    const newThreadListing = await listing(false);
    const freshThread = await startThread();
    observations.push({
      scenario: SCENARIOS[2],
      deployment: snapshotB,
      listing: newThreadListing,
      modelTurn: await turn(freshThread),
    });
    observations.push({
      scenario: SCENARIOS[3],
      deployment: snapshotB,
      listing: await listing(true),
      modelTurn: await turn(originalThread),
    });
    stage = "shutdown";
    await shutdown();
    const snapshot = await collector.closeAndSnapshot();
    const diagnostics = collector.diagnosticsSnapshot();
    return {
      schemaVersion: "renma.codex-model-freshness.v1",
      codexVersion: version,
      evidenceClass: "real-cli-app-server-model-turns",
      authentication: "chatgpt-file-linked",
      codexAnalyticsExplicitlyAllowed: true,
      observations,
      providerPresence: {
        scope: "collector-lifetime-across-all-four-turns",
        knownFixtureObserved:
          snapshot.injectedSkills.includes(LISTING_FIXTURE_NAME),
        unknownSkillObserved: snapshot.unrecognizedSkillObserved,
        pipeline: classifyPipelineDiagnostics(diagnostics),
      },
      limitations: {
        artifactProvenance: "experiment-wrapper",
        artifactDoesNotProveInjectedRevision: true,
        perTurnMetricAttribution: "unsupported",
        injectedRevision: "unsupported",
        midTurnMutation: "not-tested",
        remoteCacheBehavior: "not-tested",
        producerTtl: "unsupported",
        generalExecutionGuarantee: false,
      },
    };
  } finally {
    if (pending) clearTimeout(pending.timer);
    if (activeTurn) clearTimeout(activeTurn.timer);
    await shutdown();
    await barrierOperation;
    if (collector) await collector.closeAndSnapshot();
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
    await cleanupCharacterizationIsolatedDirectories(directories);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const barrierMode = args.includes("--midturn-capability");
  const emitRuntimeOtel = args.includes("--emit-runtime-otel");
  if (emitRuntimeOtel && !barrierMode)
    throw new Error("Runtime OTLP requires barrier mode");
  if (args.filter((arg) => arg === "--emit-runtime-otel").length > 1)
    throw new Error("Duplicate projection option");
  const consentArgs = args.filter((arg) => arg !== "--emit-runtime-otel");
  requireOptIn(
    barrierMode
      ? consentArgs.filter((arg) => arg !== "--midturn-capability")
      : consentArgs,
  );
  if (args.filter((arg) => arg === "--midturn-capability").length > 1)
    throw new Error("Duplicate mode");
  if (!barrierMode) return run("between-turn");
  const direct = await run("direct-tool", emitRuntimeOtel);
  const skill = await run("skill-midturn", emitRuntimeOtel);
  return {
    schemaVersion: "renma.codex-midturn-capability.v1",
    evidenceClass: "real-cli-app-server-model-turns",
    rows: [direct, skill],
  };
}

main().then(
  (report) => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`),
  () => {
    process.stderr.write(
      `Model freshness experiment unavailable or failed at ${stage}; no raw diagnostics retained\n`,
    );
    process.exitCode = 1;
  },
);
