import { spawnSync } from "node:child_process";
import {
  mkdir,
  readFile,
  writeFile,
  copyFile,
  realpath,
} from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
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
import { FixtureRpc } from "../../codex-plugin-usage/src/rpc.js";
import { createHub, type Consumer, type Producer } from "./hub.js";
const COMPANION = "renma-observer-fixture";
let stage = "consent";
async function run() {
  const args = process.argv.slice(2);
  const reverse = args.includes("--beta-first");
  requireOptIn(args.filter((a) => a !== "--beta-first"));
  const first: Consumer = reverse ? "beta" : "alpha";
  const hub = await createHub(first);
  const owned: {
    dirs: Awaited<ReturnType<typeof createCharacterizationIsolatedDirectories>>;
    rpc?: FixtureRpc;
  }[] = [];
  try {
    const setup = async (producer: Producer) => {
      stage = `setup-${producer}`;
      const dirs = await createCharacterizationIsolatedDirectories();
      const owner: (typeof owned)[number] = { dirs };
      owned.push(owner);
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
      const config = `[analytics]\nenabled = true\n[otel]\nmetrics_exporter = { otlp-http = { endpoint = "${hub.base}/metrics/${producer}", protocol = "json" } }\n`;
      const configPath = join(dirs.codexHomeDirectory, "config.toml");
      await writeFile(configPath, config);
      const output = join(dirs.rootDirectory, "reduced");
      await mkdir(output);
      const fixture = await installFixtureFiles(
        dirs.homeDirectory,
        cwd,
        dirs.codexHomeDirectory,
        Number(new URL(hub.base).port),
        output,
        true,
      );
      // Assemble both plugins before the fresh marketplace is installed.
      for (const [plugin, consumer] of [
        [PLUGIN, "alpha"],
        [COMPANION, "beta"],
      ] as const) {
        const root = join(dirs.homeDirectory, "plugins", plugin);
        await mkdir(join(root, ".codex-plugin"), { recursive: true });
        await mkdir(join(root, "scripts"), { recursive: true });
        const manifest = JSON.parse(
          await readFile(
            join(fixture.plugin, ".codex-plugin/plugin.json"),
            "utf8",
          ),
        );
        manifest.name = plugin;
        if (plugin === COMPANION) delete manifest.skills;
        await writeFile(
          join(root, ".codex-plugin/plugin.json"),
          JSON.stringify(manifest),
        );
        await writeFile(
          join(root, "package.json"),
          JSON.stringify({ type: "module" }),
        );
        await copyFile(
          fileURLToPath(new URL("observer.js", import.meta.url)),
          join(root, "scripts/observer.js"),
        );
        await writeFile(
          join(root, ".mcp.json"),
          JSON.stringify({
            mcpServers: {
              [`observer-${consumer}`]: {
                command: process.execPath,
                args: [
                  join(
                    dirs.codexHomeDirectory,
                    "plugins/cache/personal",
                    plugin,
                    "1.0.0/scripts/observer.js",
                  ),
                  hub.base,
                  producer,
                  consumer,
                ],
              },
            },
          }),
        );
      }
      const market = join(
        dirs.homeDirectory,
        ".agents/plugins/marketplace.json",
      );
      const marketplace = JSON.parse(await readFile(market, "utf8"));
      marketplace.plugins.push({
        name: COMPANION,
        source: { source: "local", path: `./plugins/${COMPANION}` },
        policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
        category: "Productivity",
      });
      await writeFile(market, JSON.stringify(marketplace));
      const command = (args: string[]) => {
        stage = `command-${producer}-${args[0]}-${args[1] ?? "version"}`;
        const r = spawnSync("codex", args, {
          cwd,
          env,
          encoding: "utf8",
          timeout: 60000,
          maxBuffer: 128 * 1024,
        });
        if (r.status !== 0) throw new Error("CLI command failed");
        return r;
      };
      const version = command(["--version"]).stdout.trim();
      if (!/^codex-cli [0-9]+\.[0-9]+\.[0-9]+$/.test(version))
        throw new Error("Version unavailable");
      command(["plugin", "marketplace", "add", dirs.homeDirectory]);
      for (const name of [PLUGIN, COMPANION])
        command(["plugin", "add", `${name}@personal`, "--json"]);
      const cache = join(
        dirs.codexHomeDirectory,
        "plugins/cache/personal",
        PLUGIN,
        "1.0.0",
      );
      await verifyInstalled(cache);
      for (const name of [PLUGIN, COMPANION]) {
        if (
          !(
            await readFile(
              join(
                dirs.codexHomeDirectory,
                "plugins/cache/personal",
                name,
                "1.0.0/scripts/observer.js",
              ),
            )
          ).equals(
            await readFile(
              fileURLToPath(new URL("observer.js", import.meta.url)),
            ),
          )
        )
          throw new Error("Installed bytes mismatch");
      }
      stage = `exporter-check-${producer}`;
      if (
        !(await readFile(configPath, "utf8")).includes(
          `${hub.base}/metrics/${producer}`,
        )
      )
        throw new Error("Exporter config overwritten");
      const baseline = listingServerArguments();
      const replaced = (s: string | undefined) =>
        s?.startsWith("otel.metrics_exporter=") ||
        s?.startsWith("analytics.enabled=");
      const serverArgs = baseline.filter(
        (s, i) => !replaced(s) && !(s === "-c" && replaced(baseline[i + 1])),
      );
      owner.rpc = new FixtureRpc(
        [
          ...serverArgs,
          "-c",
          "features.multi_agent=false",
          "-c",
          "project_doc_max_bytes=0",
        ],
        cwd,
        env,
      );
      return {
        producer,
        owner,
        cwd,
        cache,
        version,
        config,
        configPath,
        rpc: owner.rpc,
      };
    };
    const a = await setup("first"),
      b = await setup("second");
    stage = "parallel-initialize";
    await Promise.all([a.rpc.initialize(), b.rpc.initialize()]);
    const [ta, tb] = await Promise.all([
      a.rpc.startThread(a.cwd),
      b.rpc.startThread(b.cwd),
    ]);
    const status = (rpc: FixtureRpc, threadId: string) =>
      rpc.request(
        "mcpServerStatus/list",
        { threadId, detail: "toolsAndAuthOnly" },
        (value) => {
          const data = object(value)?.data;
          if (!Array.isArray(data)) throw new Error("Status unavailable");
          return [PLUGIN, COMPANION].map((plugin) => {
            const matches = data
              .map(object)
              .filter((r) => r?.pluginId === `${plugin}@personal`);
            const r = matches.length === 1 ? matches[0] : undefined;
            return {
              plugin,
              connected: r?.runtimeStatus === "connected",
              toolsErrorObserved: typeof r?.toolsError === "string",
              knownServer: [
                "renma-observer-alpha",
                "renma-observer-beta",
              ].includes(String(object(r?.serverInfo)?.name)),
            };
          });
        },
      );
    await delay(2000);
    const connections = [await status(a.rpc, ta), await status(b.rpc, tb)];
    const turns: {
      producer: Producer;
      skill: string;
      phase: string;
      status: string;
      startedAt: string;
      completedAt: string;
    }[] = [];
    const turn = async (
      client: typeof a,
      thread: string,
      consumer: Consumer,
      phase: string,
    ) => {
      const skill = `renma-usage-${consumer}`,
        name = `${PLUGIN}:${skill}`;
      const startedAt = new Date().toISOString();
      const result = await client.rpc.turn(thread, [
        {
          type: "text",
          text: `$${name} Follow this synthetic Skill and return a short acknowledgement.`,
        },
        {
          type: "skill",
          name,
          path: join(client.cache, "skills", skill, "SKILL.md"),
        },
      ]);
      turns.push({
        producer: client.producer,
        skill,
        phase,
        status: result,
        startedAt,
        completedAt: new Date().toISOString(),
      });
    };
    stage = "parallel-turns";
    for (const consumer of ["alpha", "beta"] as const)
      await Promise.all([
        turn(a, ta, consumer, "both-alive"),
        turn(b, tb, consumer, "both-alive"),
      ]);
    await delay(2000);
    stage = "stop-first";
    await a.rpc.close();
    delete a.owner.rpc;
    const hubSurvivedFirstExit = await fetch(`${hub.base}/health`).then(
      async (r) => {
        await r.body?.cancel();
        return r.status === 200;
      },
    );
    stage = "survivor-turn";
    const survivorThread = await b.rpc.startThread(b.cwd);
    await turn(b, survivorThread, "alpha", "first-exited-new-thread");
    for (let i = 0; i < 20; i++) {
      if (hub.snapshot().producers[1]!.acknowledged.alpha >= 2) break;
      await delay(1000);
    }
    await b.rpc.close();
    delete b.owner.rpc;
    const exporterEndpointTextPreserved =
      (await readFile(a.configPath, "utf8")).includes(
        `${hub.base}/metrics/first`,
      ) &&
      (await readFile(b.configPath, "utf8")).includes(
        `${hub.base}/metrics/second`,
      );
    return {
      schemaVersion: "renma.telemetry-coexistence.v1",
      evidenceClass: "real-cli-two-synthetic-plugins",
      versions: [a.version, b.version],
      authentication: "chatgpt-file-linked",
      analyticsConsent: true,
      startupOrder: first,
      startupOrderControl:
        "fixture-gates-second-consumer-until-first-registers",
      exporterConfiguredBeforePluginInstall: true,
      exporterEndpointTextPreserved,
      installedObserverBytesVerified: true,
      connections,
      turns,
      hubSurvivedFirstExit,
      telemetry: hub.snapshot(),
      scope: "owned-loopback-fixture-not-authenticated-production-collector",
    };
  } finally {
    for (const owner of owned) {
      await owner.rpc?.close();
      await cleanupCharacterizationIsolatedDirectories(owner.dirs);
    }
    await hub.close();
  }
}
run()
  .then((r) => process.stdout.write(JSON.stringify(r, null, 2) + "\n"))
  .catch(() => {
    process.stderr.write(
      JSON.stringify({ stage, outcome: "failed-no-conclusion" }) + "\n",
    );
    process.exitCode = 1;
  });
