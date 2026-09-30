import { object } from "../../codex-model-freshness/src/contract.js";
import {
  mkdir,
  writeFile,
  readFile,
  realpath,
  appendFile,
} from "node:fs/promises";
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
  observer,
  type Asset,
} from "../../codex-duplicate-skill-identity/src/evidence.js";
const live = process.argv.includes("--live");
const output = process.argv[process.argv.indexOf("--output") + 1];
if (!process.argv.includes("--output") || !output)
  throw new Error("Output path required");
const report: {
  schema: string;
  live: boolean;
  startedAtUTC: string;
  turnsAttempted: number;
  results: unknown[];
} = {
  schema: "renma.plugin-skill-read.v1",
  live,
  startedAtUTC: new Date().toISOString(),
  turnsAttempted: 0,
  results: [],
};
const save = () => writeFile(output, JSON.stringify(report, null, 2) + "\n");
async function run() {
  for (const repetition of [1, 2])
    for (const layout of ["one-plugin"] as const) {
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
            const projected = metricProjection(parsed, assets);
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
        const plugins = ["identity-shared"];
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
          const plugin = plugins[0];
          const rel = join(alias.toLowerCase(), "code-review", "SKILL.md");
          const source = plugin
            ? join(d.homeDirectory, "plugins", plugin, "skills", rel)
            : join(d.workspaceDirectory, ".agents/skills", rel);
          const description =
            alias === "A"
              ? "Review payment transaction retry logic and duplicate-charge prevention. Use for payment idempotency questions."
              : "Review mobile application offline synchronization and conflicting edits. Use for mobile offline merge questions.";
          await mkdir(join(source, ".."), { recursive: true });
          const content = `---\nname: code-review\ndescription: ${description}\nmetadata:\n  renma.id: experiment.${alias.toLowerCase()}.code-review\n---\n\nSynthetic fixture ${alias}. Give a concise review checklist for the requested domain. After reading these instructions, do not use more tools or access files.\n`;
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
        const hookFile = join(d.workspaceDirectory, ".hook-observations.jsonl");
        const pluginRoot = join(d.homeDirectory, "plugins", "identity-shared");
        await mkdir(join(pluginRoot, "hooks"), { recursive: true });
        await writeFile(
          join(pluginRoot, "hooks/observe.cjs"),
          await readFile(
            new URL(
              "../../../../experiments/codex-plugin-skill-read/src/observe.cjs",
              import.meta.url,
            ),
          ),
        );
        const quote = (v: string) => "'" + v.replaceAll("'", "'\\''") + "'";
        await writeFile(
          join(pluginRoot, "hooks/hooks.json"),
          JSON.stringify({
            hooks: Object.fromEntries(
              ["SessionStart", "PreToolUse", "PostToolUse", "Stop"].map(
                (event) => [
                  event,
                  [
                    {
                      hooks: [
                        {
                          type: "command",
                          command:
                            quote(process.execPath) +
                            ' "${PLUGIN_ROOT}/hooks/observe.cjs" ' +
                            quote(hookFile),
                          timeout: 10,
                        },
                      ],
                    },
                  ],
                ],
              ),
            ),
          }),
        );
        for (const [name, description] of [
          ["sql-tuning", "Optimize SQL query plans and database indexes."],
          [
            "accessibility",
            "Review web accessibility and keyboard navigation.",
          ],
          ["release-notes", "Write release notes from a change list."],
          ["image-layout", "Review image composition and visual spacing."],
        ]) {
          const dir = join(pluginRoot, "skills", name!);
          await mkdir(dir, { recursive: true });
          await writeFile(
            join(dir, "SKILL.md"),
            `---\nname: ${name}\ndescription: ${description}\n---\nGive a concise checklist.\n`,
          );
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
        const makeRpc = () =>
          new FixtureRpc(
            [
              ...listingServerArguments(),
              "-c",
              `analytics.enabled=${live}`,
              "-c",
              `otel.metrics_exporter={ otlp-http = { endpoint = "http://127.0.0.1:${addr.port}/v1/metrics", protocol = "json" } }`,
              "-c",
              "features.multi_agent=false",
              "-c",
              "project_doc_max_bytes=0",
            ],
            d.workspaceDirectory,
            env,
            obs.observe,
          );
        rpc = makeRpc();
        await rpc.initialize();
        if (
          !(
            await readFile(
              join(
                d.codexHomeDirectory,
                "plugins/cache/personal/identity-shared/1.0.0/hooks/observe.cjs",
              ),
            )
          ).equals(await readFile(join(pluginRoot, "hooks/observe.cjs")))
        )
          throw new Error("Hook bytes mismatch");
        const approvals = await rpc.request(
          "hooks/list",
          { cwds: [d.workspaceDirectory] },
          (value) => {
            const data = object(value)?.data;
            if (!Array.isArray(data)) throw new Error("Hook listing missing");
            const matches = data
              .flatMap((d) => {
                const h = object(d)?.hooks;
                return Array.isArray(h) ? h : [];
              })
              .map(object)
              .filter((h) => h?.pluginId === "identity-shared@personal");
            if (matches.length !== 4) throw new Error("Unexpected hooks");
            const expected =
              quote(process.execPath) +
              ' "${PLUGIN_ROOT}/hooks/observe.cjs" ' +
              quote(hookFile);
            const root = join(
              d.codexHomeDirectory,
              "plugins/cache/personal/identity-shared/1.0.0",
            );
            const expectedCommands = [
              expected,
              expected.replaceAll("${PLUGIN_ROOT}", root),
              expected.replaceAll(
                "${PLUGIN_ROOT}",
                root.replace(/^\/var\//, "/private/var/"),
              ),
            ];
            return matches.map((h) => {
              if (
                !expectedCommands.includes(String(h?.command)) ||
                typeof h?.key !== "string" ||
                h.key.length > 4096 ||
                typeof h?.currentHash !== "string" ||
                !/^([a-f0-9]{64}|sha256:[a-f0-9]{64})$/.test(h.currentHash)
              )
                throw new Error("Unvetted hook");
              return { key: h.key, hash: h.currentHash };
            });
          },
        );
        await rpc.close();
        await appendFile(
          join(d.codexHomeDirectory, "config.toml"),
          approvals
            .map(
              (a) =>
                `\n[hooks.state.${JSON.stringify(a.key)}]\ntrusted_hash = ${JSON.stringify(a.hash)}\n`,
            )
            .join(""),
        );
        rpc = makeRpc();
        await rpc.initialize();
        const discovery = await rpc.request(
          "skills/list",
          { cwds: [d.workspaceDirectory], forceReload: true },
          (v) => {
            const data = object(v)?.data;
            const all = Array.isArray(data)
              ? data
                  .flatMap((d) => {
                    const a = object(d)?.skills;
                    return Array.isArray(a) ? a : [];
                  })
                  .map(object)
              : [];
            return {
              targets: listing(v, assets),
              distractors: [
                "sql-tuning",
                "accessibility",
                "release-notes",
                "image-layout",
              ].map((name) => ({
                name,
                found: all.some(
                  (r) =>
                    r?.name === `identity-shared:${name}` &&
                    r?.enabled === true,
                ),
              })),
            };
          },
        );
        const hooksMetadata = await rpc.request(
          "hooks/list",
          { cwds: [d.workspaceDirectory] },
          (value) => {
            const data = object(value)?.data;
            if (!Array.isArray(data)) return [];
            return data
              .flatMap((d) => {
                const hooks = object(d)?.hooks;
                return Array.isArray(hooks) ? hooks : [];
              })
              .map(object)
              .filter((h) => h?.pluginId === "identity-shared@personal")
              .map((h) => ({
                event: [
                  "sessionStart",
                  "preToolUse",
                  "postToolUse",
                  "stop",
                ].includes(String(h?.eventName))
                  ? h?.eventName
                  : "other",
                enabled: h?.enabled === true,
                trustStatus: [
                  "untrusted",
                  "trusted",
                  "modified",
                  "managed",
                ].includes(String(h?.trustStatus))
                  ? h?.trustStatus
                  : "other",
              }));
          },
        );
        if (
          hooksMetadata.length !== 4 ||
          hooksMetadata.some((h) => !h.enabled || h.trustStatus !== "trusted")
        )
          throw new Error("Hooks are not trusted");
        const row = {
          hooksMetadata,
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
          let previousHookCount = 0;
          for (const scenario of [
            "payments",
            "mobile",
            "explicit-control",
            "negative-control",
          ] as const) {
            const a = assets[0]!;
            if (report.turnsAttempted >= 8) throw new Error("Turn cap");
            report.turnsAttempted++;
            await save();
            const start = obs.events.length;
            const thread = await rpc.startThread(d.workspaceDirectory);
            let status = "failed";
            try {
              const text =
                scenario === "payments"
                  ? "Please review a payment retry design: a timeout makes the client retry the same charge. Give a brief checklist for avoiding duplicate charges."
                  : scenario === "mobile"
                    ? "Please review a mobile offline synchronization design: two devices edit the same record while disconnected. Give a brief checklist for resolving conflicting edits."
                    : scenario === "negative-control"
                      ? "What is 2 plus 2? Answer briefly; no tools are needed."
                      : `$${a.name} Give a brief checklist.`;
              status = await rpc.turn(thread, [
                { type: "text", text },
                ...(scenario === "explicit-control"
                  ? [{ type: "skill", name: a.name, path: a.path }]
                  : []),
              ]);
            } catch {
              /* finite failure retained */
            }
            let hooks: unknown[] = [];
            try {
              hooks = (await readFile(hookFile, "utf8"))
                .trim()
                .split("\n")
                .filter(Boolean)
                .map((line) => JSON.parse(line));
            } catch {}
            row.turns.push({
              hooks: hooks.slice(previousHookCount),
              scenario,
              selection:
                scenario === "explicit-control"
                  ? "explicit-name-and-path"
                  : "plain-task-no-skill-name-or-path",
              status,
              eventStart: start,
              eventEnd: obs.events.length,
            });
            previousHookCount = hooks.length;
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
            hooksMetadata,
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
  console.error("Plugin Skill read experiment failed; inspect reduced report.");
  process.exitCode = 1;
});
