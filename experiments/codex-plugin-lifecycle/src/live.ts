import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile, realpath, access } from "node:fs/promises";
import { homedir } from "node:os";
import { join, isAbsolute } from "node:path";
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
import {
  installFixtureFiles,
  verifyInstalled,
  PLUGIN,
} from "../../codex-plugin-usage/src/fixture.js";
import {
  createUsageCollector,
  SKILLS,
} from "../../codex-plugin-usage/src/collector.js";
import { FixtureRpc } from "../../codex-plugin-usage/src/rpc.js";
import { reduceConfig, reducePlugins } from "./state.js";

let stage = "options";
async function run() {
  const [helpers, python, ...consent] = process.argv.slice(2);
  if (!helpers || !isAbsolute(helpers) || !python || !isAbsolute(python))
    throw new Error("Helper paths required");
  const primeExisting = consent.includes("--prime-existing-threads");
  requireOptIn(consent.filter((arg) => arg !== "--prime-existing-threads"));
  const dirs = await createCharacterizationIsolatedDirectories();
  const collector = await createUsageCollector(0, undefined, true);
  let rpc: FixtureRpc | undefined;
  const abort = () => {
    void rpc?.close();
  };
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  try {
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
    const command = (exe: string, args: string[]) => {
      const r = spawnSync(exe, args, {
        cwd,
        env,
        encoding: "utf8",
        timeout: 60000,
        maxBuffer: 128 * 1024,
      });
      if (r.status !== 0) throw new Error("Control command failed");
      return r.stdout.trim();
    };
    stage = "auth";
    const auth = spawnSync(
      "codex",
      ["-c", 'cli_auth_credentials_store="file"', "login", "status"],
      { cwd, env, encoding: "utf8", timeout: 15000, maxBuffer: 16384 },
    );
    if (
      auth.status !== 0 ||
      !/^Logged in using ChatGPT\s*$/im.test(auth.stdout + "\n" + auth.stderr)
    )
      throw new Error("ChatGPT login unavailable");
    const codexVersion = command("codex", ["--version"]);
    if (!/^codex-cli \d+\.\d+\.\d+$/.test(codexVersion))
      throw new Error("Version unavailable");
    const configPath = join(dirs.codexHomeDirectory, "config.toml");
    await writeFile(
      configPath,
      `[analytics]\nenabled = true\n[otel]\nmetrics_exporter = { otlp-http = { endpoint = "${collector.endpoint}", protocol = "json" } }\n`,
    );
    const output = join(dirs.rootDirectory, "reduced");
    await mkdir(output);
    const fixture = await installFixtureFiles(
      dirs.homeDirectory,
      cwd,
      dirs.codexHomeDirectory,
      Number(new URL(collector.endpoint).port),
      output,
      true,
    );
    stage = "install";
    command("codex", ["plugin", "marketplace", "add", dirs.homeDirectory]);
    command("codex", ["plugin", "add", `${PLUGIN}@personal`, "--json"]);
    const originalCache = join(
      dirs.codexHomeDirectory,
      "plugins/cache/personal",
      PLUGIN,
      "1.0.0",
    );
    await verifyInstalled(originalCache);
    const base = listingServerArguments();
    const override = (arg: string | undefined) =>
      arg?.startsWith("analytics.enabled=") ||
      arg?.startsWith("otel.metrics_exporter=");
    rpc = new FixtureRpc(
      [
        ...base.filter(
          (arg, i) =>
            !override(arg) && !(arg === "-c" && override(base[i + 1])),
        ),
        "-c",
        "features.multi_agent=false",
        "-c",
        "project_doc_max_bytes=0",
      ],
      cwd,
      env,
    );
    await rpc.initialize();
    const inventory = async () => ({
      configuration: await rpc!.request(
        "config/read",
        { cwd, includeLayers: false },
        reduceConfig,
      ),
      plugin: await rpc!.request(
        "plugin/list",
        { cwds: [cwd], marketplaceKinds: ["local"] },
        reducePlugins,
      ),
      skills: await rpc!.request(
        "skills/list",
        { cwds: [cwd], forceReload: true },
        (value) => {
          const data = object(value)?.data;
          const skills =
            Array.isArray(data) && data.length === 1
              ? object(data[0])?.skills
              : undefined;
          if (!Array.isArray(skills)) throw new Error("Listing unavailable");
          return SKILLS.map((skill) => {
            const rows = skills
              .map(object)
              .filter(
                (row) =>
                  row?.name === `${PLUGIN}:${skill}` || row?.name === skill,
              );
            return {
              skill,
              entries: rows.length,
              enabled: rows.length === 1 ? rows[0]?.enabled === true : null,
            };
          });
        },
      ),
    });
    const setEnabled = async (enabled: boolean) =>
      rpc!.request(
        "config/value/write",
        {
          keyPath: `plugins."${PLUGIN}@personal".enabled`,
          value: enabled,
          mergeStrategy: "replace",
        },
        (value) => {
          if (object(value)?.status !== "ok")
            throw new Error("Config not applied");
          return {
            enabled,
            status: "ok" as const,
            observedAt: new Date().toISOString(),
          };
        },
      );
    const turns: {
      scenario: string;
      requestedSkill: (typeof SKILLS)[number];
      status: string;
      startedAt: string;
      completedAt: string;
      observedThrough: string;
      sampleStartIndex: number;
      sampleEndIndex: number;
      receiverHealthy: boolean;
      receivedRequestsBefore: number;
      receivedRequestsAfter: number;
      rejectedRequestsAfter: number;
    }[] = [];
    const runTurn = async (
      scenario: string,
      thread: string,
      skill: (typeof SKILLS)[number],
    ) => {
      stage = scenario;
      const beforeSnapshot = collector.snapshot();
      const before = beforeSnapshot.samples.length;
      const startedAt = new Date().toISOString();
      const status = await rpc!.turn(thread, [
        {
          type: "text",
          text: `Use $${PLUGIN}:${skill}. Follow this synthetic Skill if it is available; otherwise return a short acknowledgement. Do not call tools or read or write files. Return only a short acknowledgement.`,
        },
      ]);
      const completedAt = new Date().toISOString();
      await delay(4000);
      const end = collector.snapshot();
      const health = await fetch(new URL("/health", collector.endpoint), {
        signal: AbortSignal.timeout(2000),
      });
      await health.body?.cancel();
      const row = {
        scenario,
        requestedSkill: skill,
        status,
        startedAt,
        completedAt,
        observedThrough: new Date().toISOString(),
        sampleStartIndex: before,
        sampleEndIndex: end.samples.length,
        receivedRequestsBefore: beforeSnapshot.requests,
        receivedRequestsAfter: end.requests,
        rejectedRequestsAfter: end.rejectedRequests,
        receiverHealthy: health.status === 200,
      };
      turns.push(row);
      process.stderr.write(
        JSON.stringify({
          stage,
          status,
          acceptedSamples: end.samples.length - before,
        }) + "\n",
      );
      return row;
    };
    const primingTurns: {
      phase: string;
      status: string;
      startedAt: string;
      completedAt: string;
      sampleStartIndex: number;
      sampleEndIndex: number;
    }[] = [];
    const existingThread = async (phase: string) => {
      const thread = await rpc!.startThread(cwd);
      if (primeExisting) {
        stage = `prime-${phase}`;
        const before = collector.snapshot().samples.length;
        const startedAt = new Date().toISOString();
        const status = await rpc!.turn(thread, [
          {
            type: "text",
            text: "Return a short acknowledgement. Do not use Skills, call tools, or read or write files.",
          },
        ]);
        const completedAt = new Date().toISOString();
        await delay(4000);
        primingTurns.push({
          phase,
          status,
          startedAt,
          completedAt,
          sampleStartIndex: before,
          sampleEndIndex: collector.snapshot().samples.length,
        });
        process.stderr.write(JSON.stringify({ stage, status }) + "\n");
      }
      return thread;
    };
    const transitions = [];
    transitions.push({
      phase: "installed",
      observedAt: new Date().toISOString(),
      ...(await inventory()),
    });
    await runTurn("baseline-alpha", await rpc.startThread(cwd), SKILLS[0]);
    await runTurn("baseline-beta", await rpc.startThread(cwd), SKILLS[1]);
    // Each existing thread has never requested a Skill before its transition.
    const beforeDisable = await existingThread("before-disable");
    const disabled = await setEnabled(false);
    transitions.push({
      phase: "disabled",
      observedAt: new Date().toISOString(),
      write: disabled,
      ...(await inventory()),
    });
    await runTurn("disabled-existing-unused-thread", beforeDisable, SKILLS[1]);
    await runTurn("disabled-new-thread", await rpc.startThread(cwd), SKILLS[1]);
    const enabled = await setEnabled(true);
    transitions.push({
      phase: "reenabled",
      observedAt: new Date().toISOString(),
      write: enabled,
      ...(await inventory()),
    });
    await runTurn(
      "reenabled-new-thread",
      await rpc.startThread(cwd),
      SKILLS[1],
    );
    const beforeUpdate = await existingThread("before-update");
    stage = "update";
    const marketplace = command(python, [
      join(helpers, "read_marketplace_name.py"),
      "--marketplace-path",
      join(dirs.homeDirectory, ".agents/plugins/marketplace.json"),
    ]);
    if (marketplace !== "personal") throw new Error("Marketplace mismatch");
    const skillPath = join(fixture.plugin, "skills", SKILLS[0], "SKILL.md");
    await writeFile(
      skillPath,
      (await readFile(skillPath, "utf8")).replace(
        /^description:.*$/m,
        "description: Synthetic updated lifecycle fixture.",
      ),
    );
    command(python, [
      join(helpers, "update_plugin_cachebuster.py"),
      fixture.plugin,
    ]);
    const updatedVersion = object(
      JSON.parse(
        await readFile(
          join(fixture.plugin, ".codex-plugin/plugin.json"),
          "utf8",
        ),
      ),
    )?.version;
    if (
      typeof updatedVersion !== "string" ||
      !/^1\.0\.0\+codex\.[A-Za-z0-9-]+$/.test(updatedVersion)
    )
      throw new Error("Version mismatch");
    const mcpPath = join(fixture.plugin, ".mcp.json");
    const mcp = JSON.parse(await readFile(mcpPath, "utf8"));
    mcp.mcpServers["usage-receiver"].args[0] = join(
      dirs.codexHomeDirectory,
      "plugins/cache/personal",
      PLUGIN,
      updatedVersion,
      "scripts/mcp.js",
    );
    await writeFile(mcpPath, JSON.stringify(mcp));
    command(python, [join(helpers, "validate_plugin.py"), fixture.plugin]);
    command("codex", ["plugin", "add", `${PLUGIN}@personal`, "--json"]);
    const cacheExists = async (path: string) => {
      try {
        await access(path);
        return true;
      } catch {
        return false;
      }
    };
    transitions.push({
      phase: "updated",
      observedAt: new Date().toISOString(),
      originalCacheExists: await cacheExists(originalCache),
      ...(await inventory()),
    });
    await runTurn("updated-existing-unused-thread", beforeUpdate, SKILLS[0]);
    await runTurn("updated-new-thread", await rpc.startThread(cwd), SKILLS[0]);
    const beforeRemove = await existingThread("before-remove");
    stage = "remove";
    command("codex", ["plugin", "remove", `${PLUGIN}@personal`, "--json"]);
    transitions.push({
      phase: "removed",
      observedAt: new Date().toISOString(),
      updatedCacheExists: await cacheExists(
        join(
          dirs.codexHomeDirectory,
          "plugins/cache/personal",
          PLUGIN,
          updatedVersion,
        ),
      ),
      ...(await inventory()),
    });
    await runTurn("removed-existing-unused-thread", beforeRemove, SKILLS[1]);
    await runTurn("removed-new-thread", await rpc.startThread(cwd), SKILLS[1]);
    await delay(10000);
    const beforeShutdownSampleCount = collector.snapshot().samples.length;
    await rpc.close();
    rpc = undefined;
    await delay(1000);
    return {
      schemaVersion: "renma.plugin-lifecycle.live.v1",
      evidenceClass: "real-cli-model-turns-and-provider-metrics",
      codexVersion,
      authentication: "existing-chatgpt-file-login",
      analyticsEnabled: true,
      selectionMode: "text-name-only-no-explicit-skill-path",
      existingThreadPreparation: primeExisting
        ? "completed-neutral-turn-no-skill-request"
        : "thread-start-only",
      primingTurns,
      producerEpochs: 1,
      receiverEpochs: 1,
      postTurnWaitMs: 4000,
      finalDrainWaitMs: 10000,
      updatedVersion,
      transitions,
      turns,
      exporterEndpointTextPreserved: (
        await readFile(configPath, "utf8")
      ).includes(collector.endpoint),
      beforeShutdownSampleCount,
      collector: collector.snapshot(),
      limits: {
        modelContent: "discarded",
        injectedRevision: "unsupported",
        noSample: "unknown-not-zero",
        attribution: "receipt-window-not-turn-causality",
      },
    };
  } finally {
    await rpc?.close();
    await collector.close();
    await cleanupCharacterizationIsolatedDirectories(dirs);
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
  }
}
run()
  .then((result) =>
    process.stdout.write(JSON.stringify(result, null, 2) + "\n"),
  )
  .catch(() => {
    process.stderr.write(
      JSON.stringify({ stage, outcome: "failed-no-conclusion" }) + "\n",
    );
    process.exitCode = 1;
  });
