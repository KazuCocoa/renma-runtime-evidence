import { spawnSync } from "node:child_process";
import {
  readFile,
  writeFile,
  mkdir,
  access,
  realpath,
  copyFile,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createProbe } from "./probe.js";
import { join, isAbsolute } from "node:path";
import {
  createCharacterizationIsolatedDirectories,
  cleanupCharacterizationIsolatedDirectories,
} from "../../codex-cli-integration/src/skill-injected-characterization.js";
import {
  listingEnvironment,
  listingServerArguments,
} from "../../codex-listing-freshness/src/listing.js";
import { object } from "../../codex-model-freshness/src/contract.js";
import {
  installFixtureFiles,
  PLUGIN,
} from "../../codex-plugin-usage/src/fixture.js";
import {
  createUsageCollector,
  SKILLS,
} from "../../codex-plugin-usage/src/collector.js";
import { FixtureRpc } from "../../codex-plugin-usage/src/rpc.js";
import { reduceConfig, reducePlugins } from "./state.js";
let stage = "options";
let diagnostic: string[] = [];
async function run() {
  const [flag, helpers, python] = process.argv.slice(2);
  if (
    !["--metadata-only", "--effective-config", "--runtime-lifecycle"].includes(
      flag ?? "",
    ) ||
    !helpers ||
    !isAbsolute(helpers) ||
    !python ||
    !isAbsolute(python) ||
    process.argv.length !== 5
  )
    throw new Error("Explicit helper path required");
  const runtime = flag === "--runtime-lifecycle";
  const effective = flag !== "--metadata-only";
  const probe = runtime ? await createProbe() : undefined;
  const dirs = await createCharacterizationIsolatedDirectories();
  const collector = await createUsageCollector(0, undefined, true);
  let rpc: FixtureRpc | undefined;
  try {
    const cwd = await realpath(dirs.workspaceDirectory);
    const env = listingEnvironment(
      process.env,
      dirs.homeDirectory,
      dirs.codexHomeDirectory,
      dirs.rootDirectory,
    );
    const command = (exe: string, args: string[]) => {
      const r = spawnSync(exe, args, {
        cwd,
        env,
        encoding: "utf8",
        timeout: 60000,
        maxBuffer: 128 * 1024,
      });
      if (r.status !== 0) {
        diagnostic = [
          "not found",
          "no such file",
          "module",
          "permission",
          "pyenv",
          "developer",
          "xcrun",
          "invalid",
          "HOME",
          "JSON",
          "Traceback",
        ].filter((word) =>
          (r.stderr ?? "").toLowerCase().includes(word.toLowerCase()),
        );
        if (r.error) diagnostic.push("spawn-error");
        throw new Error("Control command failed");
      }
      return r;
    };
    const configPath = join(dirs.codexHomeDirectory, "config.toml");
    await writeFile(
      configPath,
      `[analytics]\nenabled = false\n[otel]\nmetrics_exporter = { otlp-http = { endpoint = "${collector.endpoint}", protocol = "json" } }\n`,
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
    const companion = "renma-observer-fixture";
    if (runtime) {
      for (const [name, role] of [
        [PLUGIN, "primary"],
        [companion, "companion"],
      ]) {
        const root = join(dirs.homeDirectory, "plugins", name!);
        await mkdir(join(root, ".codex-plugin"), { recursive: true });
        await mkdir(join(root, "scripts"), { recursive: true });
        const manifest = JSON.parse(
          await readFile(
            join(fixture.plugin, ".codex-plugin/plugin.json"),
            "utf8",
          ),
        );
        manifest.name = name;
        if (name === companion) delete manifest.skills;
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
              [role === "primary" ? "usage-receiver" : "companion-observer"]: {
                command: process.execPath,
                args: [
                  join(
                    dirs.codexHomeDirectory,
                    "plugins/cache/personal",
                    name!,
                    "1.0.0/scripts/observer.js",
                  ),
                  probe!.base,
                  role,
                  "initial",
                ],
              },
            },
          }),
        );
      }
      const path = join(dirs.homeDirectory, ".agents/plugins/marketplace.json");
      const market = JSON.parse(await readFile(path, "utf8"));
      market.plugins.push({
        name: companion,
        source: { source: "local", path: `./plugins/${companion}` },
        policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
        category: "Productivity",
      });
      await writeFile(path, JSON.stringify(market));
    }
    const codexVersion = command("codex", ["--version"]).stdout.trim();
    if (!/^codex-cli \d+\.\d+\.\d+$/.test(codexVersion))
      throw new Error("Version unavailable");
    stage = "marketplace";
    command("codex", ["plugin", "marketplace", "add", dirs.homeDirectory]);
    stage = "install";
    command("codex", ["plugin", "add", `${PLUGIN}@personal`, "--json"]);
    if (runtime)
      command("codex", ["plugin", "add", `${companion}@personal`, "--json"]);
    const originalCache = join(
      dirs.codexHomeDirectory,
      "plugins/cache/personal",
      PLUGIN,
      "1.0.0",
    );
    const exists = async (path: string) => {
      try {
        await access(path);
        return true;
      } catch {
        return false;
      }
    };
    const start = async (disabled: false | "quoted" | "unquoted" = false) => {
      rpc = new FixtureRpc(
        [
          ...listingServerArguments(),
          ...(disabled
            ? [
                "-c",
                disabled === "quoted"
                  ? `plugins."${PLUGIN}@personal".enabled=false`
                  : `plugins.${PLUGIN}@personal.enabled=false`,
              ]
            : []),
        ],
        cwd,
        env,
      );
      await rpc.initialize();
    };
    const observe = async (phase: string, forceReload: boolean) => {
      // Snapshot existing processes first, then start a new ephemeral thread.
      if (runtime) await delay(750);
      const beforeNewThread = probe?.snapshot();
      if (runtime) {
        await rpc!.startThread(cwd);
        await delay(1500);
      }
      const afterNewThread = probe?.snapshot();
      const skills = await rpc!.request(
        "skills/list",
        { cwds: [cwd], forceReload },
        (value) => {
          const data = object(value)?.data;
          const list =
            Array.isArray(data) && data.length === 1
              ? object(data[0])?.skills
              : undefined;
          if (!Array.isArray(list)) throw new Error("Listing unavailable");
          return SKILLS.map((skill) => {
            const found = list
              .map(object)
              .filter(
                (s) => s?.name === `${PLUGIN}:${skill}` || s?.name === skill,
              );
            const s = found.length === 1 ? found[0] : undefined;
            return {
              skill,
              entries: found.length,
              enabled: s ? s.enabled === true : null,
              revision:
                s?.description === "Synthetic updated lifecycle fixture."
                  ? "updated"
                  : typeof s?.description === "string" &&
                      s.description.startsWith("Synthetic ")
                    ? "initial"
                    : "absent-or-unknown",
            };
          });
        },
      );
      const configuration = effective
        ? await rpc!.request(
            "config/read",
            { cwd, includeLayers: false },
            reduceConfig,
          )
        : undefined;
      const plugins = effective
        ? await rpc!.request(
            "plugin/list",
            { cwds: [cwd], marketplaceKinds: ["local"] },
            reducePlugins,
          )
        : undefined;
      const health = await fetch(new URL("/health", collector.endpoint), {
        signal: AbortSignal.timeout(2000),
      });
      await health.body?.cancel();
      return {
        phase,
        observedAt: new Date().toISOString(),
        forceReload,
        skills,
        configuration,
        plugins,
        beforeNewThread,
        afterNewThread,
        sharedReceiverHealthy: health.status === 200,
        originalCacheExists: await exists(originalCache),
        exporterEndpointTextPreserved: (
          await readFile(configPath, "utf8")
        ).includes(collector.endpoint),
      };
    };
    const phases = [];
    stage = "installed-listing";
    await start();
    phases.push(await observe("installed", true));
    await rpc!.close();
    rpc = undefined;
    stage = "disabled-listing";
    await start("quoted");
    phases.push(await observe("disabled-startup-override", true));
    await rpc!.close();
    rpc = undefined;
    if (effective) {
      stage = "unquoted-startup-override";
      await start("unquoted");
      phases.push(await observe(stage, true));
      await rpc!.close();
      rpc = undefined;
    }
    stage = "reenabled-listing";
    await start();
    phases.push(await observe("reenabled", true));
    const writes: { enabled: boolean; status: string }[] = [];
    if (effective) {
      for (const enabled of [false, true]) {
        stage = enabled ? "persistent-enable" : "persistent-disable";
        const status = await rpc!.request(
          "config/value/write",
          {
            keyPath: `plugins."${PLUGIN}@personal".enabled`,
            value: enabled,
            mergeStrategy: "replace",
          },
          (value) => {
            const status = object(value)?.status;
            if (status !== "ok" && status !== "okOverridden")
              throw new Error("Write failed");
            return status;
          },
        );
        writes.push({ enabled, status });
        phases.push(await observe(`${stage}-existing-server`, true));
        await rpc!.close();
        rpc = undefined;
        await start();
        phases.push(await observe(`${stage}-new-server`, true));
      }
    }
    stage = "update-source";
    const market = join(dirs.homeDirectory, ".agents/plugins/marketplace.json");
    stage = "read-marketplace-helper";
    const marketplace = command(python, [
      join(helpers, "read_marketplace_name.py"),
      "--marketplace-path",
      market,
    ]).stdout.trim();
    if (marketplace !== "personal") {
      diagnostic = [
        marketplace.includes("personal")
          ? "known-name-present"
          : "known-name-absent",
        marketplace.length === 0 ? "empty" : "nonempty",
        marketplace.includes("mise") ? "mise" : "not-mise",
      ];
      throw new Error("Marketplace mismatch");
    }
    const skillPath = join(fixture.plugin, "skills", SKILLS[0], "SKILL.md");
    await writeFile(
      skillPath,
      (await readFile(skillPath, "utf8")).replace(
        /^description:.*$/m,
        "description: Synthetic updated lifecycle fixture.",
      ),
    );
    stage = "cachebuster-helper";
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
      throw new Error("Unexpected cachebuster");
    const mcpPath = join(fixture.plugin, ".mcp.json");
    const mcp = JSON.parse(await readFile(mcpPath, "utf8"));
    mcp.mcpServers["usage-receiver"].args[0] = join(
      dirs.codexHomeDirectory,
      "plugins/cache/personal",
      PLUGIN,
      updatedVersion,
      runtime ? "scripts/observer.js" : "scripts/mcp.js",
    );
    if (runtime) mcp.mcpServers["usage-receiver"].args[3] = "updated";
    await writeFile(mcpPath, JSON.stringify(mcp));
    command(python, [join(helpers, "validate_plugin.py"), fixture.plugin]);
    stage = "reinstall";
    command("codex", ["plugin", "add", `${PLUGIN}@personal`, "--json"]);
    phases.push(await observe("updated-existing-server-default", false));
    phases.push(await observe("updated-existing-server-forced", true));
    await rpc!.close();
    rpc = undefined;
    stage = "updated-fresh-server";
    await start();
    phases.push(await observe("updated-new-server", true));
    const updatedCache = join(
      dirs.codexHomeDirectory,
      "plugins/cache/personal",
      PLUGIN,
      updatedVersion,
    );
    const updatedCachePresentBeforeRemove = await exists(updatedCache);
    stage = "remove";
    command("codex", ["plugin", "remove", `${PLUGIN}@personal`, "--json"]);
    phases.push(await observe("removed-existing-server-default", false));
    phases.push(await observe("removed-existing-server-forced", true));
    await rpc!.close();
    rpc = undefined;
    stage = "removed-fresh-server";
    await start();
    phases.push(await observe("removed-new-server", true));
    await rpc!.close();
    rpc = undefined;
    if (runtime) await delay(750);
    return {
      processControlEvidence: probe
        ? "wrapper-issued-instance-heartbeats-not-provider-usage"
        : undefined,
      afterServerShutdown: probe?.snapshot(),
      schemaVersion: effective
        ? "renma.plugin-lifecycle.config.v1"
        : "renma.plugin-lifecycle.metadata.v1",
      evidenceClass: "real-cli-metadata-only",
      codexVersion,
      modelTurns: 0,
      authenticationUsed: false,
      analyticsEnabled: false,
      disableScope: effective
        ? "startup-override-and-persistent-config-write"
        : "per-process-config-override-not-persistent-switch",
      writes,
      updatedVersion,
      updatedCachePresentBeforeRemove,
      updatedCacheExistsAfterRemove: await exists(updatedCache),
      sourceExistsAfterRemove: await exists(fixture.plugin),
      phases,
      runtimeConsumerTermination: runtime
        ? "bounded-heartbeat-and-stop-observations"
        : "not-measured",
      telemetryDeliveryDuringTransitions: "not-measured",
      coverage:
        "point-in-time-inventory-and-receiver-health-not-continuous-export-coverage",
    };
  } finally {
    await rpc?.close();
    await collector.close();
    await probe?.close();
    await cleanupCharacterizationIsolatedDirectories(dirs);
  }
}
run()
  .then((r) => process.stdout.write(JSON.stringify(r, null, 2) + "\n"))
  .catch(() => {
    process.stderr.write(
      JSON.stringify({ stage, diagnostic, outcome: "failed-no-conclusion" }) +
        "\n",
    );
    process.exitCode = 1;
  });
