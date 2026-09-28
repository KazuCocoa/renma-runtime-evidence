import { spawnSync } from "node:child_process";
import {
  mkdir,
  readFile,
  writeFile,
  realpath,
  rm,
  copyFile,
  cp,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, createHash } from "node:crypto";
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
  PLUGIN,
} from "../../codex-plugin-usage/src/fixture.js";
import { createUsageCollector } from "../../codex-plugin-usage/src/collector.js";
import { FixtureRpc } from "../../codex-plugin-usage/src/rpc.js";
import { exerciseSync } from "./sync.js";
import { BudgetedRpc } from "./budget.js";
import { startBackend } from "./backend.js";
import { durableSender } from "./sender.js";
import { observation } from "./record.js";
import { resolveCandidates, type Deployment } from "./provenance.js";

let stage = "options";
async function run() {
  const [mode, renma, helpers, python, ledger, ...consent] =
    process.argv.slice(2);
  if (
    !["current", "previous", "docker"].includes(mode ?? "") ||
    ![renma, helpers, python, ledger].every((p) => p && isAbsolute(p))
  )
    throw new Error("Explicit paths required");
  requireOptIn(consent);
  const producer =
    mode === "current"
      ? "native-current"
      : mode === "previous"
        ? "native-previous"
        : "docker-current";
  const producerEpoch =
    mode === "current" ? "run-1" : mode === "previous" ? "run-2" : "run-3";
  return exerciseSync(renma!, async (root, manifest) => {
    const dirs = await createCharacterizationIsolatedDirectories();
    const token = randomBytes(32).toString("hex");
    const backend = await startBackend(join(root, "received.json"), token);
    const sender = durableSender(
      join(root, "pending.json"),
      backend.endpoint,
      token,
    );
    let candidates: Deployment[] = ["initial"],
      cursor = 0,
      unprojectable = 0;
    let collector: Awaited<ReturnType<typeof createUsageCollector>> | undefined;
    let rpc: BudgetedRpc | undefined;
    let timer: NodeJS.Timeout | undefined;
    let packageVersion = "1.0.0";
    try {
      collector = await createUsageCollector(
        0,
        () => {
          if (!collector) return;
          const samples = collector.snapshot().samples;
          for (; cursor < samples.length; cursor++) {
            const sample = samples[cursor]!;
            try {
              sender.enqueue(
                observation({
                  schemaVersion: "renma.local-observation.v1",
                  producer,
                  producerEpoch,
                  receiverEpoch: "first",
                  evidenceClass: "real-cli",
                  observedAt: sample.observedAt,
                  skill: sample.skill,
                  providerLabel: sample.providerSkill,
                  value: sample.value,
                  aggregation: sample.aggregation,
                  monotonic: sample.monotonic,
                  seriesIdentity: "not-retained",
                  intervalStart: sample.startTimeUnixNano,
                  intervalEnd: sample.timeUnixNano,
                  deployments: candidates,
                  manifest,
                }),
              );
            } catch {
              unprojectable++;
            }
          }
        },
        true,
      );
      timer = setInterval(() => {
        void sender.flush();
      }, 200);
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
      const call = (exe: string, args: string[]) => {
        const r = spawnSync(exe, args, {
          cwd,
          env,
          encoding: "utf8",
          timeout: 30000,
          maxBuffer: 128 * 1024,
        });
        if (r.status !== 0) throw new Error("Control command failed");
        return r.stdout.trim();
      };
      const version = call("codex", ["--version"]);
      if (!/^codex-cli \d+\.\d+\.\d+$/.test(version))
        throw new Error("Version unknown");
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
      await rm(join(fixture.plugin, "skills/renma-usage-dormant"), {
        recursive: true,
      });
      const script = await readFile(
        fileURLToPath(new URL("plugin-client.js", import.meta.url)),
        "utf8",
      );
      await writeFile(join(fixture.plugin, "scripts/plugin-client.js"), script);
      await writeFile(
        join(fixture.plugin, ".mcp.json"),
        JSON.stringify({
          mcpServers: {
            "telemetry-client": {
              command: "node",
              args: [
                "--input-type=module",
                "-e",
                script,
                new URL("/health", collector.endpoint).toString(),
              ],
            },
          },
        }),
      );
      const packageDeployment = async (deployment: Deployment) => {
        for (const skill of ["renma-usage-alpha", "renma-usage-beta"])
          await copyFile(
            join(root, "bundles", deployment, skill, "SKILL.md"),
            join(fixture.plugin, "skills", skill, "SKILL.md"),
          );
        await writeFile(
          join(fixture.plugin, "deployment.json"),
          JSON.stringify(
            manifest.filter((row) => row.deployment === deployment),
          ),
        );
      };
      await packageDeployment("initial");
      stage = "validate-plugin";
      call(python!, [join(helpers!, "validate_plugin.py"), fixture.plugin]);
      stage = "install";
      call("codex", ["plugin", "marketplace", "add", dirs.homeDirectory]);
      call("codex", ["plugin", "add", `${PLUGIN}@personal`, "--json"]);
      const verifyPackage = async (deployment: Deployment) => {
        const cache = join(
          dirs.codexHomeDirectory,
          "plugins/cache/personal",
          PLUGIN,
          packageVersion,
        );
        for (const row of manifest.filter(
          (row) => row.deployment === deployment,
        )) {
          const bytes = await readFile(
            join(cache, "skills", row.skill, "SKILL.md"),
          );
          if (
            `sha256:${createHash("sha256").update(bytes).digest("hex")}` !==
            row.contentDigest
          )
            throw new Error("Installed digest mismatch");
        }
        if (
          (await readFile(join(cache, ".mcp.json"), "utf8")) !==
          (await readFile(join(fixture.plugin, ".mcp.json"), "utf8"))
        )
          throw new Error("Bootstrap mismatch");
      };
      await verifyPackage("initial");
      const base = listingServerArguments();
      const overridden = (arg: string | undefined) =>
        arg?.startsWith("analytics.enabled=") ||
        arg?.startsWith("otel.metrics_exporter=");
      rpc = new BudgetedRpc(
        [
          ...base.filter(
            (arg, i) =>
              !overridden(arg) && !(arg === "-c" && overridden(base[i + 1])),
          ),
          "-c",
          "features.multi_agent=false",
          "-c",
          "project_doc_max_bytes=0",
        ],
        cwd,
        env,
        ledger!,
        mode === "current" ? "plugin-integration" : "version-compatibility",
      );
      await rpc.initialize();
      const status = async (client: FixtureRpc, thread: string) =>
        client.request(
          "mcpServerStatus/list",
          { threadId: thread, detail: "toolsAndAuthOnly" },
          (value) => {
            const data = object(value)?.data;
            if (!Array.isArray(data)) throw new Error("MCP status unavailable");
            const matches = data
              .map(object)
              .filter((row) => row?.pluginId === `${PLUGIN}@personal`);
            const row = matches.length === 1 ? matches[0] : undefined;
            return {
              matches: matches.length,
              connected: row?.runtimeStatus === "connected",
              serverIdentified:
                object(row?.serverInfo)?.name ===
                "renma-local-telemetry-client",
              toolsErrorObserved: typeof row?.toolsError === "string",
            };
          },
        );
      const turns: {
        scenario: string;
        status: string;
        observedAt: string;
        backendRecords: number;
        mcp: Awaited<ReturnType<typeof status>>;
      }[] = [];
      const turn = async (scenario: string, skill: string, thread?: string) => {
        stage = scenario;
        const id = thread ?? (await rpc!.startThread(cwd));
        await delay(500);
        const mcp = await status(rpc!, id);
        const result = await rpc!.turn(id, [
          {
            type: "text",
            text: `Use $${PLUGIN}:${skill}. Follow this synthetic Skill. Do not use tools or other Skills. Return a short acknowledgement.`,
          },
        ]);
        await delay(2500);
        await sender.flush();
        turns.push({
          scenario,
          status: result,
          observedAt: new Date().toISOString(),
          backendRecords: backend.snapshot().records.length,
          mcp,
        });
        process.stderr.write(
          JSON.stringify({
            stage,
            status: result,
            backendRecords: backend.snapshot().records.length,
          }) + "\n",
        );
      };
      await turn("initial-alpha", "renma-usage-alpha");
      await turn("initial-beta", "renma-usage-beta");
      let secondHome: unknown = null;
      if (mode === "current") {
        // Identical source package, different HOME/CODEX_HOME; no rewriting installed-script paths.
        stage = "second-home";
        const second = await createCharacterizationIsolatedDirectories();
        let secondRpc: FixtureRpc | undefined;
        try {
          await cp(
            join(dirs.homeDirectory, "plugins"),
            join(second.homeDirectory, "plugins"),
            { recursive: true },
          );
          await cp(
            join(dirs.homeDirectory, ".agents"),
            join(second.homeDirectory, ".agents"),
            { recursive: true },
          );
          const secondCwd = await realpath(second.workspaceDirectory);
          const secondEnv = listingEnvironment(
            process.env,
            second.homeDirectory,
            second.codexHomeDirectory,
            second.rootDirectory,
          );
          for (const args of [
            ["plugin", "marketplace", "add", second.homeDirectory],
            ["plugin", "add", `${PLUGIN}@personal`, "--json"],
          ]) {
            const command = spawnSync("codex", args, {
              cwd: secondCwd,
              env: secondEnv,
              timeout: 30000,
              maxBuffer: 128 * 1024,
              encoding: "utf8",
            });
            if (command.status !== 0) throw new Error("Second install failed");
          }
          secondRpc = new FixtureRpc(
            listingServerArguments(),
            secondCwd,
            secondEnv,
          );
          await secondRpc.initialize();
          const thread = await secondRpc.startThread(secondCwd);
          await delay(500);
          secondHome = {
            modelTurns: 0,
            sameMcpConfiguration:
              (await readFile(
                join(
                  second.codexHomeDirectory,
                  "plugins/cache/personal",
                  PLUGIN,
                  "1.0.0/.mcp.json",
                ),
                "utf8",
              )) ===
              (await readFile(join(fixture.plugin, ".mcp.json"), "utf8")),
            mcp: await status(secondRpc, thread),
          };
        } finally {
          await secondRpc?.close();
          await cleanupCharacterizationIsolatedDirectories(second);
        }
        const update = async (deployment: Deployment) => {
          stage = `update-${deployment}`;
          const market = call(python!, [
            join(helpers!, "read_marketplace_name.py"),
            "--marketplace-path",
            join(dirs.homeDirectory, ".agents/plugins/marketplace.json"),
          ]);
          if (market !== "personal") throw new Error("Marketplace mismatch");
          await packageDeployment(deployment);
          call(python!, [
            join(helpers!, "update_plugin_cachebuster.py"),
            fixture.plugin,
          ]);
          const value = object(
            JSON.parse(
              await readFile(
                join(fixture.plugin, ".codex-plugin/plugin.json"),
                "utf8",
              ),
            ),
          )?.version;
          if (
            typeof value !== "string" ||
            !/^1\.0\.0\+codex\.[A-Za-z0-9-]+$/.test(value)
          )
            throw new Error("Cachebuster unavailable");
          packageVersion = value;
          call(python!, [join(helpers!, "validate_plugin.py"), fixture.plugin]);
          candidates = [...candidates, deployment];
          call("codex", ["plugin", "add", `${PLUGIN}@personal`, "--json"]);
          await verifyPackage(deployment);
        };
        await update("same-content");
        await turn("same-content-new-thread", "renma-usage-alpha");
        const old = await rpc.startThread(cwd);
        await update("changed");
        await turn("changed-existing-thread", "renma-usage-alpha", old);
        await turn("changed-new-thread", "renma-usage-alpha");
        await update("dirty");
        await turn("dirty-new-thread", "renma-usage-alpha");
      }
      stage = "drain";
      await rpc.close();
      rpc = undefined;
      await delay(1500);
      await sender.flush();
      const records = backend.snapshot().records;
      return {
        mode,
        version,
        operatingSystem: process.platform,
        architecture: process.arch,
        nodeVersion: process.version,
        modelTurns: turns.length,
        turns,
        secondHome,
        installedPackageDigestsVerified: true,
        unprojectableSamples: unprojectable,
        exporterEndpointTextPreserved: (
          await readFile(configPath, "utf8")
        ).includes(collector.endpoint),
        queue: sender.snapshot(),
        backend: backend.snapshot(),
        collector: collector.snapshot(),
        resolution: records.map((record) => ({
          observedAt: record.observedAt,
          skill: record.skill,
          ...resolveCandidates(
            record.manifest,
            record.deployments,
            record.providerLabel,
          ),
        })),
        limits: {
          setup: "explicit-wrapper-owned-broker-and-exporter-config",
          packageFormat: "legacy-codex-plugin-compatibility-format",
          collectorGuarantee: "wrapper-retries-not-provider-losslessness",
        },
      };
    } finally {
      if (timer) clearInterval(timer);
      await rpc?.close();
      await collector?.close();
      await backend.close();
      await cleanupCharacterizationIsolatedDirectories(dirs);
    }
  });
}
run()
  .then((result) =>
    process.stdout.write(JSON.stringify(result, null, 2) + "\n"),
  )
  .catch(() => {
    process.stderr.write(
      JSON.stringify({ stage, outcome: "integration-failed" }) + "\n",
    );
    process.exitCode = 1;
  });
