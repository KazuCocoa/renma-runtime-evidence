import { mkdir, writeFile, copyFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SKILLS, type Skill } from "./collector.js";

export const PLUGIN = "renma-usage-fixture";
export function skillBytes(skill: Skill) {
  return `---\nname: ${skill}\ndescription: Synthetic ${skill} measurement; use only when explicitly requested by exact name.\nmetadata:\n  renma:\n    id: fixture:${skill}\n---\n\nThis is a synthetic telemetry fixture. Return a short acknowledgement. Do not use tools, read files, call any other Skill, or create files.\n`;
}
export async function installFixtureFiles(
  home: string,
  workspace: string,
  codexHome: string,
  port: number,
  output: string,
  shared = false,
) {
  const market = join(home, ".agents/plugins");
  const plugin = join(home, "plugins", PLUGIN);
  await mkdir(market, { recursive: true });
  await mkdir(join(plugin, ".codex-plugin"), { recursive: true });
  await mkdir(join(plugin, "scripts"), { recursive: true });
  await writeFile(
    join(plugin, ".codex-plugin/plugin.json"),
    JSON.stringify({
      name: PLUGIN,
      version: "1.0.0",
      description: "Synthetic multi-source usage telemetry experiment",
      author: { name: "Renma runtime evidence fixture" },
      interface: {
        displayName: "Synthetic usage fixture",
        shortDescription: "Measure synthetic Skill observations",
        longDescription:
          "Temporary local fixture for measuring plugin Skill observation times and counter samples.",
        developerName: "Renma runtime evidence fixture",
        category: "Productivity",
        capabilities: [],
        defaultPrompt: ["Run the synthetic usage fixture."],
      },
      skills: "./skills/",
      mcpServers: "./.mcp.json",
    }),
  );
  const manifest = [];
  for (const [index, skill] of SKILLS.entries()) {
    const repositoryId =
      index === 1 ? "fixture-repository-b" : "fixture-repository-a";
    const source = join(workspace, "sources", repositoryId, skill);
    const bundled = join(plugin, "skills", skill);
    await mkdir(source, { recursive: true });
    await mkdir(bundled, { recursive: true });
    await writeFile(join(source, "SKILL.md"), skillBytes(skill));
    await copyFile(join(source, "SKILL.md"), join(bundled, "SKILL.md"));
    manifest.push({
      skill,
      assetId: `fixture:${skill}`,
      repositoryId,
      pluginId: PLUGIN,
      pluginVersion: "1.0.0",
      contentDigest: `sha256:${createHash("sha256").update(skillBytes(skill)).digest("hex")}`,
    });
  }
  for (const name of ["collector.js", "mcp.js"])
    await copyFile(
      fileURLToPath(new URL(name, import.meta.url)),
      join(plugin, "scripts", name),
    );
  await writeFile(
    join(plugin, "package.json"),
    JSON.stringify({ type: "module" }),
  );
  await writeFile(
    join(plugin, ".mcp.json"),
    JSON.stringify({
      mcpServers: {
        "usage-receiver": {
          command: process.execPath,
          args: [
            join(
              codexHome,
              "plugins/cache/personal",
              PLUGIN,
              "1.0.0/scripts/mcp.js",
            ),
            String(port),
            output,
            ...(shared ? ["--shared"] : []),
          ],
        },
      },
    }),
  );
  await writeFile(
    join(market, "marketplace.json"),
    JSON.stringify({
      name: "personal",
      interface: { displayName: "Synthetic isolated fixture" },
      plugins: [
        {
          name: PLUGIN,
          source: { source: "local", path: `./plugins/${PLUGIN}` },
          policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
          category: "Productivity",
        },
      ],
    }),
  );
  return { plugin, manifest };
}
export async function verifyInstalled(cacheRoot: string) {
  for (const script of ["collector.js", "mcp.js"]) {
    const known = await readFile(
      fileURLToPath(new URL(script, import.meta.url)),
    );
    if (!(await readFile(join(cacheRoot, "scripts", script))).equals(known))
      throw new Error("Installed collector mismatch");
  }
  for (const skill of SKILLS)
    if (
      (await readFile(join(cacheRoot, "skills", skill, "SKILL.md"), "utf8")) !==
      skillBytes(skill)
    )
      throw new Error("Installed fixture mismatch");
}
