import { spawnSync } from "node:child_process";
import { mkdir, cp, readFile, writeFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
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
import { object } from "../../codex-model-freshness/src/contract.js";
import {
  createUsageCollector,
  type Skill,
} from "../../codex-plugin-usage/src/collector.js";
import { FixtureRpc } from "../../codex-plugin-usage/src/rpc.js";
import { manifest, type Mapping } from "./manifest.js";

/** Full loop: actual Renma-cataloged bytes -> CLI-installed bundle -> actual provider labels. */
export async function liveDeployments(root: string, rows: readonly Mapping[]) {
  const results = [];
  const mapping = manifest(rows);
  for (const deployment of ["before", "after"] as const) {
    const selected = rows.filter((r) => r.deployment === deployment);
    const aliases = new Map<string, Skill>(
      selected.map((r) => [
        `${r.plugin}_${r.name}`,
        r.assetId === "skill.fixture-alpha"
          ? "renma-usage-alpha"
          : "renma-usage-beta",
      ]),
    );
    const collector = await createUsageCollector(0, undefined, false, aliases);
    const dirs = await createCharacterizationIsolatedDirectories();
    let rpc: FixtureRpc | undefined;
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
      const plugins = [...new Set(selected.map((r) => r.plugin))];
      for (const plugin of plugins) {
        const destination = join(dirs.homeDirectory, "plugins", plugin);
        await cp(join(root, "bundles", deployment, plugin), destination, {
          recursive: true,
        });
        await mkdir(join(destination, ".codex-plugin"));
        await writeFile(
          join(destination, ".codex-plugin/plugin.json"),
          JSON.stringify({
            name: plugin,
            version: selected.find((r) => r.plugin === plugin)!.version,
            description: "Synthetic Renma identity experiment",
            author: { name: "Renma fixture" },
            interface: {
              displayName: "Renma identity fixture",
              shortDescription: "Synthetic identity verification",
              longDescription:
                "Owned temporary fixture to verify Renma identity mapping through installed plugin Skills.",
              developerName: "Renma fixture",
              category: "Productivity",
              capabilities: [],
              defaultPrompt: ["Run the fixture Skill."],
            },
            skills: "./skills/",
          }),
        );
      }
      await mkdir(join(dirs.homeDirectory, ".agents/plugins"), {
        recursive: true,
      });
      await writeFile(
        join(dirs.homeDirectory, ".agents/plugins/marketplace.json"),
        JSON.stringify({
          name: "personal",
          interface: { displayName: "Renma identity fixture" },
          plugins: plugins.map((name) => ({
            name,
            source: { source: "local", path: `./plugins/${name}` },
            policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
            category: "Productivity",
          })),
        }),
      );
      const command = (args: string[]) => {
        const r = spawnSync("codex", args, {
          cwd,
          env,
          encoding: "utf8",
          timeout: 60000,
          maxBuffer: 128 * 1024,
        });
        if (r.status !== 0) throw new Error("CLI unavailable");
        return r;
      };
      const version = command(["--version"]).stdout.trim();
      if (!/^codex-cli \d+\.\d+\.\d+$/.test(version))
        throw new Error("Unsupported version");
      command(["plugin", "marketplace", "add", dirs.homeDirectory]);
      for (const plugin of plugins)
        command(["plugin", "add", `${plugin}@personal`, "--json"]);
      const installed: { row: Mapping; path: string }[] = [];
      for (const row of selected) {
        const path = await realpath(
          join(
            dirs.codexHomeDirectory,
            "plugins/cache/personal",
            row.plugin,
            row.version,
            "skills",
            row.name,
            "SKILL.md",
          ),
        );
        const digest = `sha256:${createHash("sha256")
          .update(await readFile(path))
          .digest("hex")}`;
        if (digest !== row.digest) throw new Error("Installed bytes mismatch");
        installed.push({ row, path });
      }
      rpc = new FixtureRpc(
        [
          ...listingServerArguments(),
          "-c",
          "analytics.enabled=true",
          "-c",
          `otel.metrics_exporter={ otlp-http = { endpoint = "${collector.endpoint}", protocol = "json" } }`,
          "-c",
          "features.multi_agent=false",
          "-c",
          "project_doc_max_bytes=0",
        ],
        cwd,
        env,
      );
      await rpc.initialize();
      const listing = await rpc.request(
        "skills/list",
        { cwds: [cwd], forceReload: true },
        (value) => {
          const data = object(value)?.data;
          if (!Array.isArray(data) || data.length !== 1)
            throw new Error("Listing unavailable");
          const skills = object(data[0])?.skills;
          if (!Array.isArray(skills)) throw new Error("Listing unavailable");
          return installed.map(({ row, path }) => {
            const expectedName = `${row.plugin}:${row.name}`;
            const matches = skills
              .map(object)
              .filter((s) => s?.name === expectedName);
            const match = matches.length === 1 ? matches[0] : undefined;
            if (
              match?.path !== path ||
              match?.enabled !== true ||
              match?.pluginId !== `${row.plugin}@personal`
            )
              throw new Error("Listing mismatch");
            return {
              assetId: row.assetId,
              listedName: expectedName,
              installedDigestVerified: true,
              enabled: true,
            };
          });
        },
      );
      const turns = [];
      for (const { row, path } of installed) {
        const thread = await rpc.startThread(cwd);
        const name = `${row.plugin}:${row.name}`;
        const status = await rpc.turn(thread, [
          {
            type: "text",
            text: `$${name} Follow this synthetic Skill and return a short acknowledgement.`,
          },
          { type: "skill", name, path },
        ]);
        turns.push({ requestedAssetId: row.assetId, status });
      }
      for (
        let i = 0;
        i < 20 && collector.snapshot().samples.length < selected.length;
        i++
      )
        await delay(1000);
      await rpc.close();
      rpc = undefined;
      const telemetry = collector.snapshot();
      const joins = telemetry.samples.map((s) => ({
        providerLabel: s.providerSkill,
        normalizedFixtureSkill: s.skill,
        resolved: mapping.resolve(deployment, s.providerSkill),
      }));
      results.push({
        deployment,
        codexVersion: version,
        listing,
        turns,
        telemetry,
        joins,
        deploymentBinding: "wrapper-frozen-manifest-before-process-launch",
        installedByCli: true,
        installationScope: "fresh-isolated-home-per-deployment-not-hot-update",
      });
    } finally {
      await rpc?.close();
      await collector.close();
      await cleanupCharacterizationIsolatedDirectories(dirs);
    }
  }
  return results;
}
