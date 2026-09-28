import { spawnSync } from "node:child_process";
import { writeFileSync, renameSync } from "node:fs";
import { mkdir, readFile, realpath, lstat } from "node:fs/promises";
import { createServer } from "node:net";
import { once } from "node:events";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  createCharacterizationIsolatedDirectories,
  cleanupCharacterizationIsolatedDirectories,
  linkCharacterizationChatgptLogin,
} from "../../codex-cli-integration/src/skill-injected-characterization.js";
import {
  listingEnvironment,
  listingServerArguments,
} from "../../codex-listing-freshness/src/listing.js";
import {
  object,
  requireOptIn,
} from "../../codex-model-freshness/src/contract.js";
import { SKILLS, createUsageCollector } from "./collector.js";
import { installFixtureFiles, verifyInstalled, PLUGIN } from "./fixture.js";
import { FixtureRpc } from "./rpc.js";

let stage = "consent";
let diagnostic: string[] = [];
async function run() {
  const args = process.argv.slice(2);
  const shared = args.includes("--shared-collector");
  requireOptIn(args.filter((arg) => arg !== "--shared-collector"));
  const dirs = await createCharacterizationIsolatedDirectories();
  let rpc: FixtureRpc | undefined;
  let sharedCollector:
    Awaited<ReturnType<typeof createUsageCollector>> | undefined;
  const abort = () => {
    void rpc?.close();
  };
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  try {
    stage = "setup";
    const cwd = await realpath(dirs.workspaceDirectory);
    const env = {
      ...listingEnvironment(
        process.env,
        dirs.homeDirectory,
        dirs.codexHomeDirectory,
        dirs.rootDirectory,
      ),
      OTEL_METRIC_EXPORT_INTERVAL: "1000",
    };
    await linkCharacterizationChatgptLogin(
      dirs,
      process.env.CODEX_HOME || join(homedir(), ".codex"),
    );
    const command = (args: string[]) => {
      const result = spawnSync("codex", args, {
        cwd,
        env,
        encoding: "utf8",
        timeout: 60000,
        maxBuffer: 128 * 1024,
      });
      if (result.status !== 0) {
        const text = (result.stdout ?? "") + "\n" + (result.stderr ?? "");
        diagnostic = [
          "marketplace",
          "not found",
          "permission",
          "manifest",
          "invalid",
          "unknown",
          "required",
          "config",
          "source",
          "directory",
          "trusted",
          "failed",
          "unrecognized",
          "relative",
          "absolute",
        ].filter((word) => text.toLowerCase().includes(word));
      }
      return result;
    };
    const v = command(["--version"]);
    const version = v.stdout?.trim();
    if (v.status !== 0 || !/^codex-cli \d+\.\d+\.\d+$/u.test(version))
      throw new Error("Unsupported CLI");
    const auth = command([
      "-c",
      'cli_auth_credentials_store="file"',
      "login",
      "status",
    ]);
    if (
      auth.status !== 0 ||
      !/^Logged in using ChatGPT\s*$/im.test(auth.stdout + "\n" + auth.stderr)
    )
      throw new Error("Login unavailable");
    // Reserve then release an ephemeral loopback port; only the plugin binds it during the run.
    const reserve = createServer();
    reserve.listen(0, "127.0.0.1");
    await once(reserve, "listening");
    const address = reserve.address();
    if (!address || typeof address === "string")
      throw new Error("Port unavailable");
    await new Promise<void>((resolve) => reserve.close(() => resolve()));
    const output = join(dirs.rootDirectory, "reduced");
    await mkdir(output);
    if (shared) {
      const persistShared = () => {
        if (!sharedCollector) return;
        writeFileSync(
          join(output, "observations.tmp"),
          JSON.stringify(sharedCollector.snapshot()),
          { mode: 0o600 },
        );
        renameSync(
          join(output, "observations.tmp"),
          join(output, "observations.json"),
        );
      };
      sharedCollector = await createUsageCollector(
        address.port,
        persistShared,
        true,
      );
      persistShared();
    }
    const fixture = await installFixtureFiles(
      dirs.homeDirectory,
      cwd,
      dirs.codexHomeDirectory,
      address.port,
      output,
      shared,
    );
    stage = "marketplace-install";
    const marketplace = command([
      "plugin",
      "marketplace",
      "add",
      dirs.homeDirectory,
    ]);
    if (marketplace.status !== 0) throw new Error("Marketplace unavailable");
    stage = "plugin-install";
    const installed = command([
      "plugin",
      "add",
      `${PLUGIN}@personal`,
      "--json",
    ]);
    if (installed.status !== 0) throw new Error("Plugin install unavailable");
    stage = "installed-cache-verification";
    let cache = "";
    for (const version of ["local", "1.0.0"]) {
      const candidate = join(
        dirs.codexHomeDirectory,
        "plugins/cache/personal",
        PLUGIN,
        version,
      );
      try {
        await verifyInstalled(candidate);
        cache = await realpath(candidate);
        break;
      } catch {
        /* known candidate only */
      }
    }
    if (!cache) throw new Error("Installed cache unavailable");
    stage = "server";
    rpc = new FixtureRpc(
      [
        ...listingServerArguments(),
        "-c",
        "analytics.enabled=true",
        "-c",
        `otel.metrics_exporter={ otlp-http = { endpoint = "http://127.0.0.1:${address.port}/v1/metrics", protocol = "json" } }`,
        "-c",
        "features.multi_agent=false",
        "-c",
        "project_doc_max_bytes=0",
      ],
      cwd,
      env,
    );
    await rpc.initialize();
    stage = "listing";
    const listed = await rpc.request(
      "skills/list",
      { cwds: [cwd], forceReload: true },
      (value) => {
        const rows = object(value)?.data;
        if (!Array.isArray(rows) || rows.length !== 1)
          throw new Error("Listing unavailable");
        const row = object(rows[0]);
        if (
          !Array.isArray(row?.skills) ||
          !Array.isArray(row.errors) ||
          row.errors.length
        )
          throw new Error("Listing unavailable");
        const skills = row.skills;
        return SKILLS.map((skill) => {
          const candidates = skills
            .map(object)
            .filter(
              (s) => s?.name === skill || s?.name === `${PLUGIN}:${skill}`,
            );
          const s = candidates[0];
          const expected = join(cache, "skills", skill, "SKILL.md");
          if (
            candidates.length !== 1 ||
            s?.path !== expected ||
            s.enabled !== true
          ) {
            diagnostic = [
              candidates.length === 0
                ? "skill-missing"
                : candidates.length === 1
                  ? "skill-unique"
                  : "skill-ambiguous",
              s?.path === expected ? "path-matches" : "path-mismatch",
              s?.enabled === true ? "enabled" : "not-enabled",
            ];
            throw new Error("Plugin skill unavailable");
          }
          return {
            skill,
            providerName: s.name as string,
            installedPathVerified: true,
            pluginOwnerVerified: s.pluginId === `${PLUGIN}@personal`,
            enabled: true,
          };
        });
      },
    );
    stage = "thread-start";
    let thread = await rpc.startThread(cwd);
    const readObservations = async () => {
      const path = join(output, "observations.json");
      const stat = await lstat(path);
      if (!stat.isFile() || stat.size > 512 * 1024)
        throw new Error("Invalid reduced report");
      return JSON.parse(await readFile(path, "utf8"));
    };
    stage = "plugin-receiver-start";
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        await readObservations();
        ready = true;
        break;
      } catch {
        await delay(100);
      }
    }
    if (!ready) {
      diagnostic = await rpc.request(
        "mcpServerStatus/list",
        { threadId: thread, detail: "toolsAndAuthOnly" },
        (value) => {
          const data = object(value)?.data;
          if (!Array.isArray(data)) return ["mcp-list-unavailable"];
          const selected = data
            .map(object)
            .filter(
              (r) =>
                r?.pluginId === `${PLUGIN}@personal` ||
                r?.name === "usage-receiver",
            );
          return selected.length === 0
            ? ["fixture-mcp-missing"]
            : selected.flatMap((r) => [
                r?.serverInfo ? "server-initialized" : "server-not-initialized",
                ...[
                  "timed out",
                  "closed",
                  "spawn",
                  "not found",
                  "no such file",
                  "handshake",
                  "initialize",
                  "permission",
                ].filter((word) =>
                  String(r?.toolsError ?? "")
                    .toLowerCase()
                    .includes(word),
                ),
              ]);
        },
      );
      throw new Error("Plugin receiver unavailable");
    }
    const mcpStatus = async (threadId: string) =>
      rpc!.request(
        "mcpServerStatus/list",
        { threadId, detail: "toolsAndAuthOnly" },
        (value) => {
          const data = object(value)?.data;
          if (!Array.isArray(data)) throw new Error("MCP status unavailable");
          const matches = data
            .map(object)
            .filter((row) => row?.pluginId === `${PLUGIN}@personal`);
          if (matches.length !== 1)
            return {
              state: "ambiguous-or-missing",
              fixtureServerIdentified: false,
              toolsErrorObserved: false,
            };
          const row = matches[0]!;
          const state = [
            "notStarted",
            "starting",
            "connected",
            "authenticationRequired",
            "failed",
            "cancelled",
            "disabled",
          ].includes(String(row.runtimeStatus))
            ? String(row.runtimeStatus)
            : "unknown";
          return {
            state,
            fixtureServerIdentified:
              object(row.serverInfo)?.name === "renma-usage-fixture",
            toolsErrorObserved: typeof row.toolsError === "string",
          };
        },
      );
    const receiverStates = [
      { phase: "initial-thread", ...(await mcpStatus(thread)) },
    ];
    const observations = [];
    const scenarios = [
      { name: "none", skill: null, newThread: false },
      { name: "alpha-first", skill: SKILLS[0], newThread: false },
      { name: "alpha-repeat-same-thread", skill: SKILLS[0], newThread: false },
      { name: "beta-other-repository", skill: SKILLS[1], newThread: false },
      { name: "alpha-new-thread", skill: SKILLS[0], newThread: true },
    ] as const;
    for (const scenario of scenarios) {
      stage = scenario.name;
      if (scenario.newThread) {
        thread = await rpc.startThread(cwd);
        await delay(500);
        receiverStates.push({
          phase: "new-thread",
          ...(await mcpStatus(thread)),
        });
      }
      const startedAt = new Date().toISOString();
      const skill = scenario.skill;
      const name = listed.find((s) => s.skill === skill)?.providerName;
      const status = await rpc.turn(
        thread,
        skill
          ? [
              {
                type: "text",
                text: `$${name} Follow this synthetic Skill. Return only a short acknowledgement.`,
              },
              {
                type: "skill",
                name,
                path: join(cache, "skills", skill, "SKILL.md"),
              },
            ]
          : [
              {
                type: "text",
                text: "Return a short acknowledgement. Do not use Skills or tools, or read or write any files.",
              },
            ],
      );
      observations.push({
        scenario: scenario.name,
        requestedSkill: skill,
        status,
        startedAt,
        completedAt: new Date().toISOString(),
      });
      await delay(2500);
    }
    stage = "export-wait";
    // Export timing is itself under test. Wait a bounded minute for a periodic target export.
    let snapshot = await readObservations();
    for (let i = 0; i < 65; i++) {
      if (
        snapshot.samples.some((s: { skill: string }) => s.skill === SKILLS[1])
      )
        break;
      await delay(1000);
      snapshot = await readObservations();
    }
    stage = "shutdown";
    await rpc.close();
    rpc = undefined;
    const sharedReceiverSurvivedCodexShutdown = sharedCollector
      ? await fetch(`http://127.0.0.1:${address.port}/health`, {
          signal: AbortSignal.timeout(2000),
        }).then(async (response) => {
          await response.body?.cancel();
          return response.status === 200;
        })
      : null;
    snapshot = await readObservations();
    let receiverStartupFailure:
      "not-observed" | "address-in-use" | "receiver-start-failed" =
      "not-observed";
    try {
      const path = join(output, "startup-failure.json");
      const stat = await lstat(path);
      if (!stat.isFile() || stat.size > 256)
        throw new Error("Invalid startup result");
      const reason = object(JSON.parse(await readFile(path, "utf8")))?.reason;
      if (reason !== "address-in-use" && reason !== "receiver-start-failed")
        throw new Error("Invalid startup result");
      receiverStartupFailure = reason;
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
    }
    return {
      schemaVersion: "renma.plugin-usage-experiment.v1",
      evidenceClass: "real-cli-on-synthetic-plugin",
      codexVersion: version,
      authentication: "chatgpt-file-linked",
      analyticsConsent: true,
      requestedExportIntervalMs: 1000,
      pluginInstalledByCli: true,
      collectorStartedByPluginMcp: !shared,
      collectorOwner: shared ? "experiment-wrapper" : "plugin-mcp",
      sharedReceiverSurvivedCodexShutdown,
      sourceRepositories:
        "two-synthetic-source-directories-not-a-renma-sync-run",
      manifest: fixture.manifest,
      listing: listed,
      receiverStates,
      receiverStartupFailure,
      turns: observations,
      telemetry: snapshot,
      exactInjectionTime: "unsupported",
      taskSuccess: "not-measured",
    };
  } finally {
    await rpc?.close();
    await sharedCollector?.close();
    await cleanupCharacterizationIsolatedDirectories(dirs);
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
  }
}
run()
  .then((report) =>
    process.stdout.write(JSON.stringify(report, null, 2) + "\n"),
  )
  .catch(() => {
    process.stderr.write(
      JSON.stringify({
        schemaVersion: "renma.plugin-usage-failure.v1",
        stage,
        diagnostic,
        outcome: "failed-no-usage-conclusion",
      }) + "\n",
    );
    process.exitCode = 1;
  });
