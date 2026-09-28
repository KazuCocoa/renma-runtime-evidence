import { spawnSync } from "node:child_process";
import { mkdir, writeFile, realpath, readFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
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
import { createUsageCollector } from "../../codex-plugin-usage/src/collector.js";
import { FixtureRpc } from "../../codex-plugin-usage/src/rpc.js";
let stage = "setup";
async function run() {
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
    const output = join(dirs.rootDirectory, "reduced");
    await mkdir(output);
    const port = Number(new URL(collector.endpoint).port);
    const fixture = await installFixtureFiles(
      dirs.homeDirectory,
      cwd,
      dirs.codexHomeDirectory,
      port,
      output,
      true,
    );
    const options = {
      "absolute-control": join(
        dirs.codexHomeDirectory,
        "plugins/cache/personal",
        PLUGIN,
        "1.0.0/scripts/mcp.js",
      ),
      "relative-arg": "./scripts/mcp.js",
      "plugin-root": "${PLUGIN_ROOT}/scripts/mcp.js",
      "claude-root": "${CLAUDE_PLUGIN_ROOT}/scripts/mcp.js",
    };
    const servers = Object.fromEntries(
      Object.entries(options).map(([name, script]) => [
        name,
        {
          command: process.execPath,
          args: [script, String(port), output, "--shared"],
        },
      ]),
    );
    for (const [variant, variable] of [
      ["env-plugin", "PLUGIN_ROOT"],
      ["env-claude", "CLAUDE_PLUGIN_ROOT"],
      ["env-codex", "CODEX_PLUGIN_ROOT"],
    ]) {
      servers[variant!] = {
        command: "/bin/sh",
        args: [
          "-c",
          `exec node "$${variable}/scripts/mcp.js" "$1" "$2" --shared`,
          "sh",
          String(port),
          output,
        ],
      };
    }
    servers["inline-module"] = {
      command: "node",
      args: [
        "--input-type=module",
        "-e",
        await readFile(
          fileURLToPath(new URL("plugin-client.js", import.meta.url)),
          "utf8",
        ),
        new URL("/health", collector.endpoint).toString(),
      ],
    };
    const scriptPath = join(fixture.plugin, "scripts/mcp.js");
    await writeFile(
      scriptPath,
      "#!/usr/bin/env node\n" + (await readFile(scriptPath, "utf8")),
    );
    await chmod(scriptPath, 0o755);
    servers["relative-command"] = {
      command: "./scripts/mcp.js",
      args: [String(port), output, "--shared"],
    };
    await writeFile(
      join(fixture.plugin, ".mcp.json"),
      JSON.stringify({ mcpServers: servers }),
    );
    const call = (args: string[]) => {
      const result = spawnSync("codex", args, {
        cwd,
        env,
        encoding: "utf8",
        timeout: 30000,
        maxBuffer: 32768,
      });
      if (result.status !== 0) throw new Error("CLI failed");
      return result.stdout.trim();
    };
    const version = call(["--version"]);
    if (!/^codex-cli \d+\.\d+\.\d+$/.test(version))
      throw new Error("Version unknown");
    stage = "install";
    call(["plugin", "marketplace", "add", dirs.homeDirectory]);
    call(["plugin", "add", `${PLUGIN}@personal`, "--json"]);
    rpc = new FixtureRpc(listingServerArguments(), cwd, env);
    await rpc.initialize();
    stage = "thread";
    const thread = await rpc.startThread(cwd);
    await delay(1500);
    stage = "status";
    const states = await rpc.request(
      "mcpServerStatus/list",
      { threadId: thread, detail: "toolsAndAuthOnly" },
      (value) => {
        const data = object(value)?.data;
        if (!Array.isArray(data)) throw new Error("No status");
        return Object.keys(servers).map((variant) => {
          const matches = data
            .map(object)
            .filter(
              (row) =>
                row?.pluginId === `${PLUGIN}@personal` &&
                typeof row.name === "string" &&
                row.name.includes(variant),
            );
          const row = matches.length === 1 ? matches[0] : undefined;
          const runtimeStatus = [
            "connected",
            "failed",
            "starting",
            "notStarted",
            "disabled",
            "cancelled",
          ].includes(String(row?.runtimeStatus))
            ? String(row?.runtimeStatus)
            : "unknown";
          return {
            variant,
            matches: matches.length,
            runtimeStatus,
            serverIdentified:
              object(row?.serverInfo)?.name ===
              (variant === "inline-module"
                ? "renma-local-telemetry-client"
                : "renma-usage-fixture"),
            toolsErrorObserved: typeof row?.toolsError === "string",
          };
        });
      },
    );
    stage = "remove";
    call(["plugin", "remove", `${PLUGIN}@personal`, "--json"]);
    const fresh = await rpc.startThread(cwd);
    await delay(500);
    const freshPluginServers = await rpc.request(
      "mcpServerStatus/list",
      { threadId: fresh, detail: "toolsAndAuthOnly" },
      (value) => {
        const data = object(value)?.data;
        if (!Array.isArray(data)) throw new Error("No status");
        return data
          .map(object)
          .filter((row) => row?.pluginId === `${PLUGIN}@personal`).length;
      },
    );
    const health = await fetch(new URL("/health", collector.endpoint));
    const sharedCollectorStillHealthy = health.ok;
    await health.body?.cancel();
    return {
      removal: { freshPluginServers, sharedCollectorStillHealthy },
      schemaVersion: "renma.plugin-path-probe.v1",
      evidenceClass: "actual-cli-mcp-no-model",
      version,
      modelTurns: 0,
      states,
    };
  } finally {
    await rpc?.close();
    await collector.close();
    await cleanupCharacterizationIsolatedDirectories(dirs);
  }
}
run()
  .then((result) =>
    process.stdout.write(JSON.stringify(result, null, 2) + "\n"),
  )
  .catch(() => {
    process.stderr.write(
      JSON.stringify({ stage, outcome: "path-probe-failed" }) + "\n",
    );
    process.exitCode = 1;
  });
