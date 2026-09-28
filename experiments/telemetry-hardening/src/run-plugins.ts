import { readFile, writeFile, realpath } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import {
  createCharacterizationIsolatedDirectories,
  cleanupCharacterizationIsolatedDirectories,
} from "../../codex-cli-integration/src/skill-injected-characterization.js";
import {
  listingEnvironment,
  listingServerArguments,
} from "../../codex-listing-freshness/src/listing.js";
import { FixtureRpc } from "../../codex-plugin-usage/src/rpc.js";
import { createUsageCollector } from "../../codex-plugin-usage/src/collector.js";
import { object } from "../../codex-model-freshness/src/contract.js";
let stage = "setup";
async function run() {
  const [helpers, python] = process.argv.slice(2);
  if (!helpers || !python || !isAbsolute(helpers) || !isAbsolute(python))
    throw new Error("Helper paths required");
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
    const call = (exe: string, args: string[]) => {
      const r = spawnSync(exe, args, {
        cwd,
        env,
        encoding: "utf8",
        timeout: 30000,
        maxBuffer: 65536,
      });
      if (r.status !== 0) throw new Error("Command failed");
      return r.stdout.trim();
    };
    const version = call("codex", ["--version"]);
    if (!/^codex-cli \d+\.\d+\.\d+$/.test(version)) throw new Error("Version");
    const config = join(dirs.codexHomeDirectory, "config.toml");
    await writeFile(
      config,
      `[analytics]\nenabled = false\n[otel]\nmetrics_exporter = { otlp-http = { endpoint = "${collector.endpoint}", protocol = "json" } }\n`,
    );
    const names = ["renma-hardening-alpha", "renma-hardening-beta"];
    const script = await readFile(
      fileURLToPath(
        new URL(
          "../../local-telemetry-system/src/plugin-client.js",
          import.meta.url,
        ),
      ),
      "utf8",
    );
    for (const name of names) {
      stage = `create-${name}`;
      call(python, [
        join(helpers, "create_basic_plugin.py"),
        name,
        "--path",
        join(dirs.homeDirectory, "plugins"),
        "--marketplace-path",
        join(dirs.homeDirectory, ".agents/plugins/marketplace.json"),
        "--with-marketplace",
        "--with-mcp",
      ]);
      const root = join(dirs.homeDirectory, "plugins", name);
      await writeFile(
        join(root, ".mcp.json"),
        JSON.stringify({
          mcpServers: {
            [name]: {
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
      call(python, [join(helpers, "validate_plugin.py"), root]);
    }
    stage = "install";
    call("codex", ["plugin", "marketplace", "add", dirs.homeDirectory]);
    for (const name of names)
      call("codex", ["plugin", "add", `${name}@personal`, "--json"]);
    rpc = new FixtureRpc(listingServerArguments(), cwd, env);
    await rpc.initialize();
    const old = await rpc.startThread(cwd);
    await delay(700);
    const snapshot = async (phase: string, thread: string) => {
      const states = await rpc!.request(
        "mcpServerStatus/list",
        { threadId: thread, detail: "toolsAndAuthOnly" },
        (value) => {
          const data = object(value)?.data;
          if (!Array.isArray(data)) throw new Error("Status");
          return names.map((name) => {
            const found = data
              .map(object)
              .filter((row) => row?.pluginId === `${name}@personal`);
            return {
              plugin: name,
              matches: found.length,
              connected:
                found.length === 1 && found[0]?.runtimeStatus === "connected",
              identified:
                found.length === 1 &&
                object(found[0]?.serverInfo)?.name ===
                  "renma-local-telemetry-client",
            };
          });
        },
      );
      const response = await fetch(new URL("/health", collector.endpoint));
      await response.body?.cancel();
      const text = await readFile(config, "utf8");
      return {
        phase,
        observedAt: new Date().toISOString(),
        states,
        receiverHealthy: response.ok,
        exporterEndpointPreserved: text.includes(collector.endpoint),
        jsonProtocolPreserved: /protocol\s*=\s*"json"/.test(text),
      };
    };
    const events = [await snapshot("both-installed", old)];
    stage = "occupied-port";
    const collision = createServer();
    const collisionResult = await new Promise<string>((resolve) => {
      collision.once("error", (e: NodeJS.ErrnoException) =>
        resolve(
          e.code === "EADDRINUSE" ? "address-in-use" : "unexpected-error",
        ),
      );
      collision.listen(
        Number(new URL(collector.endpoint).port),
        "127.0.0.1",
        () => {
          collision.close();
          resolve("unexpected-bind");
        },
      );
    });
    events.push(await snapshot("after-port-conflict", old));
    stage = "update-alpha";
    if (
      call(python, [
        join(helpers, "read_marketplace_name.py"),
        "--marketplace-path",
        join(dirs.homeDirectory, ".agents/plugins/marketplace.json"),
      ]) !== "personal"
    )
      throw new Error("Marketplace");
    call(python, [
      join(helpers, "update_plugin_cachebuster.py"),
      join(dirs.homeDirectory, "plugins", names[0]!),
    ]);
    call(python, [
      join(helpers, "validate_plugin.py"),
      join(dirs.homeDirectory, "plugins", names[0]!),
    ]);
    call("codex", ["plugin", "add", `${names[0]}@personal`, "--json"]);
    const updated = await rpc.startThread(cwd);
    await delay(700);
    events.push(await snapshot("updated-fresh-thread", updated));
    stage = "remove-alpha";
    call("codex", ["plugin", "remove", `${names[0]}@personal`, "--json"]);
    const fresh = await rpc.startThread(cwd);
    await delay(700);
    events.push(await snapshot("removed-fresh-thread-peer-survives", fresh));
    events.push(await snapshot("removed-existing-thread", old));
    return {
      schemaVersion: "renma.hardening-plugins.v1",
      evidenceClass: "actual-cli-mcp-no-model",
      version,
      modelTurns: 0,
      collisionResult,
      events,
      limits: {
        exporter: "configuration-preservation-not-new-provider-traffic",
        plugins: "two-cooperative-authored-plugins",
        setup: "explicit-shared-receiver",
      },
    };
  } finally {
    await rpc?.close();
    await collector.close();
    await cleanupCharacterizationIsolatedDirectories(dirs);
  }
}
run()
  .then((r) => process.stdout.write(JSON.stringify(r, null, 2) + "\n"))
  .catch(() => {
    process.stderr.write(JSON.stringify({ stage, outcome: "failed" }) + "\n");
    process.exitCode = 1;
  });
