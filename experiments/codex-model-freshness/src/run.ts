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

async function run() {
  requireOptIn(process.argv.slice(2));
  const directories = await createCharacterizationIsolatedDirectories();
  let child: ChildProcess | undefined;
  let closed: Promise<void> | undefined;
  let collector: CodexSkillEvidenceCollector | undefined;
  let aborted = false;
  let stopped = false;
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
    const writeRevision = async (revision: Revision) => {
      await writeFile(skillPath, fixture(revision), { mode: 0o600 });
      if (!(await readFile(skillPath)).equals(Buffer.from(fixture(revision))))
        throw new Error("Fixture deployment failed");
      return deployment(revision);
    };
    const snapshotA = await writeRevision("a");
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
            // No server-initiated requests are needed by this bounded fixture.
            throw new Error("Unexpected server request");
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
      { clientInfo: { name: "renma_model_freshness_fixture", version: "1" } },
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
            input: [
              {
                type: "text",
                text: `$${LISTING_FIXTURE_NAME} Follow the synthetic Skill's fixed artifact instruction for this turn.`,
              },
              { type: "skill", name: LISTING_FIXTURE_NAME, path: skillPath },
            ],
          },
          startedTurnId,
        );
        stage = "turn-completion";
        activeTurn.turnId = id;
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
    const originalThread = await startThread();
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
    if (collector) await collector.closeAndSnapshot();
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
    await cleanupCharacterizationIsolatedDirectories(directories);
  }
}

run().then(
  (report) => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`),
  () => {
    process.stderr.write(
      `Model freshness experiment unavailable or failed at ${stage}; no raw diagnostics retained\n`,
    );
    process.exitCode = 1;
  },
);
