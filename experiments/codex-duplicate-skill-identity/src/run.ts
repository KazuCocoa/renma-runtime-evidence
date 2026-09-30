import { mkdir, writeFile, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { gunzipSync } from "node:zlib";
import { setTimeout as delay } from "node:timers/promises";
import { FixtureRpc } from "../../codex-plugin-usage/src/rpc.js";
import {
  listingEnvironment,
  listingServerArguments,
} from "../../codex-listing-freshness/src/listing.js";
import {
  createCharacterizationIsolatedDirectories as isolate,
  cleanupCharacterizationIsolatedDirectories as cleanup,
  linkCharacterizationChatgptLogin as login,
} from "../../codex-cli-integration/src/skill-injected-characterization.js";
import {
  listing,
  metricProjection,
  diagnosticProjection,
  observer,
  type Asset,
} from "./evidence.js";
const extended = process.argv.includes("--extended");
const live = process.argv.includes("--live");
const output = process.argv[process.argv.indexOf("--output") + 1];
if (!process.argv.includes("--output") || !output)
  throw new Error("Output path required");
const report: {
  schema: string;
  live: boolean;
  diagnosticExportersEnabled: boolean;
  startedAtUTC: string;
  turnsAttempted: number;
  results: unknown[];
} = {
  schema: "renma.duplicate-skill-identity.v1",
  live,
  diagnosticExportersEnabled: extended,
  startedAtUTC: new Date().toISOString(),
  turnsAttempted: 0,
  results: [],
};
const save = () => writeFile(output, JSON.stringify(report, null, 2) + "\n");
async function run() {
  for (const repetition of extended ? [1] : [1, 2])
    for (const layout of (extended
      ? ["workspace"]
      : ["workspace", "one-plugin", "two-plugins"]) as (
      "workspace" | "one-plugin" | "two-plugins"
    )[]) {
      const d = await isolate();
      let rpc: FixtureRpc | undefined;
      const samples: unknown[] = [];
      let assets: Asset[] = [];
      const server = createServer((req, res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        req.on("data", (b: Buffer) => {
          size += b.length;
          if (size > 1048576) req.destroy();
          else chunks.push(b);
        });
        req.on("end", () => {
          try {
            const buf = Buffer.concat(chunks);
            const body =
              req.headers["content-encoding"] === "gzip"
                ? gunzipSync(buf, { maxOutputLength: 1048576 })
                : buf;
            const parsed: unknown = JSON.parse(body.toString());
            const projected = [
              ...metricProjection(parsed, assets),
              ...(extended ? diagnosticProjection(parsed, assets) : []),
            ];
            if (samples.length + projected.length > 10000)
              throw new Error("Observation limit");
            for (const p of projected)
              samples.push({
                observedAtUTC: new Date().toISOString(),
                evidence: p,
              });
            res
              .writeHead(200, { "content-type": "application/json" })
              .end("{}");
          } catch {
            res.writeHead(400).end();
          }
        });
      });
      try {
        const env = listingEnvironment(
          process.env,
          d.homeDirectory,
          d.codexHomeDirectory,
          d.rootDirectory,
        );
        const command = (args: string[]) => {
          const r = spawnSync("codex", args, {
            cwd: d.workspaceDirectory,
            env,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
            timeout: 60000,
            maxBuffer: 131072,
          });
          if (r.status !== 0) throw new Error("CLI failed");
          return r.stdout.trim();
        };
        const version = command(["--version"]);
        if (!/^codex-cli \d+\.\d+\.\d+$/.test(version))
          throw new Error("Version unsupported");
        const plugins =
          layout === "workspace"
            ? []
            : layout === "one-plugin"
              ? ["identity-shared"]
              : ["identity-a", "identity-b"];
        for (const plugin of plugins) {
          const root = join(d.homeDirectory, "plugins", plugin);
          await mkdir(join(root, ".codex-plugin"), { recursive: true });
          await writeFile(
            join(root, ".codex-plugin/plugin.json"),
            JSON.stringify({
              name: plugin,
              version: "1.0.0",
              description: "Duplicate identity fixture",
              skills: "./skills/",
            }),
          );
        }
        for (const alias of ["A", "B"] as const) {
          const plugin =
            layout === "workspace"
              ? undefined
              : layout === "one-plugin"
                ? plugins[0]
                : plugins[alias === "A" ? 0 : 1];
          const rel = join(alias.toLowerCase(), "code-review", "SKILL.md");
          const source = plugin
            ? join(d.homeDirectory, "plugins", plugin, "skills", rel)
            : join(d.workspaceDirectory, ".agents/skills", rel);
          const description = `Synthetic identity fixture ${alias}; activate only when explicitly requested for fixture ${alias}.`;
          await mkdir(join(source, ".."), { recursive: true });
          const content = `---\nname: code-review\ndescription: ${description}\nmetadata:\n  renma.id: experiment.${alias.toLowerCase()}.code-review\n---\n\nSynthetic fixture ${alias}. Reply with a brief acknowledgement. Do not use tools or access files.\n`;
          await writeFile(source, content);
          assets.push({
            alias,
            path: plugin
              ? join(
                  d.codexHomeDirectory,
                  "plugins/cache/personal",
                  plugin,
                  "1.0.0/skills",
                  rel,
                )
              : source,
            name: plugin ? `${plugin}:code-review` : "code-review",
            description,
            ...(plugin ? { pluginId: `${plugin}@personal` } : {}),
          });
        }
        if (plugins.length) {
          await mkdir(join(d.homeDirectory, ".agents/plugins"), {
            recursive: true,
          });
          await writeFile(
            join(d.homeDirectory, ".agents/plugins/marketplace.json"),
            JSON.stringify({
              name: "personal",
              interface: { displayName: "Identity experiment" },
              plugins: plugins.map((name) => ({
                name,
                source: { source: "local", path: `./plugins/${name}` },
                policy: {
                  installation: "AVAILABLE",
                  authentication: "ON_INSTALL",
                },
                category: "Productivity",
              })),
            }),
          );
          command(["plugin", "marketplace", "add", d.homeDirectory]);
          for (const p of plugins)
            command(["plugin", "add", `${p}@personal`, "--json"]);
        }
        // Verify copied fixture bytes without retaining runtime content.
        for (const a of assets) a.path = await realpath(a.path);
        for (const a of assets)
          if (
            !(await readFile(a.path, "utf8")).includes(
              `renma.id: experiment.${a.alias.toLowerCase()}.code-review`,
            )
          )
            throw new Error("Fixture mismatch");
        if (live)
          await login(d, process.env.CODEX_HOME ?? join(homedir(), ".codex"));
        await new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen(0, "127.0.0.1", resolve);
        });
        const addr = server.address();
        if (!addr || typeof addr === "string")
          throw new Error("Collector unavailable");
        const obs = observer(assets);
        rpc = new FixtureRpc(
          [
            ...listingServerArguments(),
            "-c",
            `analytics.enabled=${live}`,
            "-c",
            `otel.metrics_exporter={ otlp-http = { endpoint = "http://127.0.0.1:${addr.port}/v1/metrics", protocol = "json" } }`,
            "-c",
            "features.multi_agent=false",
            ...(extended
              ? [
                  "-c",
                  `otel.exporter={ otlp-http = { endpoint = "http://127.0.0.1:${addr.port}/v1/logs", protocol = "json" } }`,
                  "-c",
                  `otel.trace_exporter={ otlp-http = { endpoint = "http://127.0.0.1:${addr.port}/v1/traces", protocol = "json" } }`,
                ]
              : []),
            "-c",
            "project_doc_max_bytes=0",
          ],
          d.workspaceDirectory,
          env,
          obs.observe,
        );
        await rpc.initialize();
        const discovery = await rpc.request(
          "skills/list",
          { cwds: [d.workspaceDirectory], forceReload: true },
          (v) => listing(v, assets),
        );
        const row = {
          repetition,
          layout,
          version,
          discovery,
          turns: [] as unknown[],
          samples,
          events: obs.events,
        };
        report.results.push(row);
        await save();
        if (live) {
          for (const a of assets) {
            if (report.turnsAttempted >= 12) throw new Error("Turn cap");
            report.turnsAttempted++;
            await save();
            const start = obs.events.length;
            const thread = await rpc.startThread(d.workspaceDirectory);
            let status = "failed";
            try {
              status = await rpc.turn(thread, [
                {
                  type: "text",
                  text: `$${a.name} Follow the explicitly attached synthetic Skill. Reply briefly.`,
                },
                { type: "skill", name: a.name, path: a.path },
              ]);
            } catch {
              /* finite failure retained */
            }
            row.turns.push({
              requestedAsset: a.alias,
              selection: "explicit-name-and-path",
              status,
              eventStart: start,
              eventEnd: obs.events.length,
            });
            await save();
          }
          await delay(12000);
        }
        await rpc.close();
        rpc = undefined;
        await save();
        console.log(
          JSON.stringify({
            repetition,
            layout,
            discovery,
            sampleCount: samples.length,
          }),
        );
      } finally {
        await rpc?.close();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await cleanup(d);
      }
    }
}
run().catch(async () => {
  await save();
  console.error(
    "Duplicate identity experiment failed; inspect reduced report.",
  );
  process.exitCode = 1;
});
