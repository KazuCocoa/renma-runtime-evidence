import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LISTING_FIXTURE_NAME,
  classifyListingRun,
  listingFixture,
  listingEnvironment,
  listingServerArguments,
  reduceListingResult,
  requireListingOptIn,
  type ListingScenario,
} from "./listing.js";

const MAX_STREAM_BYTES = 4 * 1024 * 1024;
const MAX_LINE_BYTES = 1024 * 1024;
const RPC_TIMEOUT_MS = 15_000;

function terminate(
  child: ChildProcess | undefined,
  signal: NodeJS.Signals,
): void {
  if (!child?.pid) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    /* Process already exited. */
  }
}

async function run() {
  requireListingOptIn(process.argv.slice(2));
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "renma-codex-listing-")),
  );
  let child: ChildProcess | undefined;
  let closed: Promise<void> | undefined;
  let pending:
    | {
        id: number;
        resolve: (value: ReturnType<typeof reduceListingResult> | null) => void;
        reject: () => void;
        timer: NodeJS.Timeout;
      }
    | undefined;
  let changedNotificationObserved = false;
  let failed = false;
  const abort = () => {
    failed = true;
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject();
      pending = undefined;
    }
    terminate(child, "SIGTERM");
  };
  const onSignal = () => abort();
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    const workspace = join(root, "workspace");
    const home = join(root, "home");
    const codexHome = join(root, "codex-home");
    const skillDirectory = join(
      workspace,
      ".agents/skills",
      LISTING_FIXTURE_NAME,
    );
    const skillPath = join(skillDirectory, "SKILL.md");
    await Promise.all(
      [home, codexHome, skillDirectory].map((path) =>
        mkdir(path, { recursive: true, mode: 0o700 }),
      ),
    );
    await writeFile(skillPath, listingFixture("a"), { mode: 0o600 });
    const environment = listingEnvironment(process.env, home, codexHome, root);
    const version = execFileSync("codex", ["--version"], {
      cwd: workspace,
      env: environment,
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 128,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!/^codex-cli \d+\.\d+\.\d+$/u.test(version))
      throw new Error("Unsupported CLI version");
    child = spawn("codex", listingServerArguments(), {
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
    let receivedBytes = 0;
    child.stdout!.on("data", (chunk: Buffer) => {
      receivedBytes += chunk.length;
      if (
        receivedBytes > MAX_STREAM_BYTES ||
        Buffer.byteLength(buffer) + chunk.length > MAX_LINE_BYTES
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
          const message = JSON.parse(line) as Record<string, unknown>;
          if (message.method === "skills/changed")
            changedNotificationObserved = true;
          if (pending && message.id === pending.id) {
            if (message.error !== undefined || message.result === undefined) {
              abort();
              return;
            }
            const reduced =
              pending.id === 0
                ? null
                : reduceListingResult(message.result, workspace, skillPath);
            clearTimeout(pending.timer);
            const callback = pending.resolve;
            pending = undefined;
            callback(reduced);
          }
        } catch {
          abort();
          return;
        }
      }
    });
    let nextId = 0;
    const request = (method: "initialize" | "skills/list", params: unknown) =>
      new Promise<ReturnType<typeof reduceListingResult> | null>(
        (resolve, reject) => {
          if (failed || pending) {
            reject(new Error("Listing RPC failed"));
            return;
          }
          const id = nextId++;
          const timer = setTimeout(abort, RPC_TIMEOUT_MS);
          pending = {
            id,
            resolve,
            reject: () => reject(new Error("Listing RPC failed")),
            timer,
          };
          child!.stdin!.write(`${JSON.stringify({ method, id, params })}\n`);
        },
      );
    await request("initialize", {
      clientInfo: { name: "renma_listing_fixture", version: "1" },
    });
    child.stdin!.write(
      `${JSON.stringify({ method: "initialized", params: {} })}\n`,
    );
    const results: {
      scenario: ListingScenario;
      observation: ReturnType<typeof reduceListingResult>;
    }[] = [];
    const observe = async (scenario: ListingScenario, forceReload: boolean) => {
      const observation = await request("skills/list", {
        cwds: [workspace],
        forceReload,
      });
      if (!observation) throw new Error("Listing RPC failed");
      results.push({ scenario, observation });
    };
    await observe("initial-a", false);
    const bodyOnlyFixture = listingFixture("a", "b");
    await writeFile(skillPath, bodyOnlyFixture, { mode: 0o600 });
    if (!(await readFile(skillPath)).equals(Buffer.from(bodyOnlyFixture))) {
      throw new Error("Synthetic file verification failed");
    }
    const knownDigest = (value: string) =>
      `sha256:${createHash("sha256").update(value).digest("hex")}`;
    // Hash only known repository-authored fixture strings, never RPC/file data.
    const wrapperBodyChange = {
      provenance: "experiment-wrapper",
      scope: "exact-known-fixture-bytes",
      replacementMatchedKnownFixture: true,
      beforeDigest: knownDigest(listingFixture("a")),
      afterDigest: knownDigest(bodyOnlyFixture),
    };
    await observe("body-only-update-default", false);
    await observe("body-only-update-force", true);
    await writeFile(skillPath, listingFixture("b"), { mode: 0o600 });
    await observe("after-update-default", false);
    await observe("after-update-force", true);
    await rm(skillDirectory, { recursive: true });
    await observe("after-removal-default", false);
    await observe("after-removal-force", true);
    return {
      schemaVersion: "renma.codex-listing-freshness.v1",
      provider: "codex",
      codexVersion: version,
      evidenceClass: "real-app-server-listing",
      authentication: "none",
      analyticsConfiguredEnabled: false,
      modelTurnStarted: false,
      classification: classifyListingRun(results),
      wrapperBodyChange,
      results,
      changedNotificationObserved,
      notificationAttribution: "unsupported",
      skillInjection: "not-measured",
      capabilityInvocation: "not-measured",
      remoteCacheBehavior: "not-measured",
    };
  } finally {
    if (pending) clearTimeout(pending.timer);
    if (child && closed) {
      terminate(child, "SIGTERM");
      const force = setTimeout(() => terminate(child, "SIGKILL"), 1_000);
      await closed;
      clearTimeout(force);
    }
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    await rm(root, { recursive: true, force: true });
  }
}

run().then(
  (report) => {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.classification === "inconclusive") process.exitCode = 1;
  },
  () => {
    process.stderr.write("Listing experiment unavailable or failed\n");
    process.exitCode = 1;
  },
);
