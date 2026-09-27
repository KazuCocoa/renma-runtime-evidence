import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  installFixtureFiles,
  PLUGIN,
  verifyInstalled,
} from "../src/fixture.js";
import { SKILLS } from "../src/collector.js";

test("two declared source directories bundle three exact skills and an MCP collector", async () => {
  const root = await mkdtemp(join(tmpdir(), "renma-plugin-fixture-test-"));
  try {
    const home = join(root, "home"),
      workspace = join(root, "workspace"),
      output = join(root, "output"),
      codexHome = join(root, "codex");
    await mkdir(output);
    const { plugin, manifest } = await installFixtureFiles(
      home,
      workspace,
      codexHome,
      12345,
      output,
    );
    await verifyInstalled(plugin);
    assert.equal(manifest.length, 3);
    assert.equal(new Set(manifest.map((row) => row.repositoryId)).size, 2);
    assert.deepEqual(
      manifest.map((row) => row.skill),
      [...SKILLS],
    );
    const catalog = JSON.parse(
      await readFile(join(home, ".agents/plugins/marketplace.json"), "utf8"),
    );
    assert.equal(catalog.plugins[0].source.path, `./plugins/${PLUGIN}`);
    const config = JSON.parse(
      await readFile(join(plugin, ".mcp.json"), "utf8"),
    );
    assert.equal(config.mcpServers["usage-receiver"].command, process.execPath);
    assert.equal(
      config.mcpServers["usage-receiver"].args[0],
      join(codexHome, "plugins/cache/personal", PLUGIN, "1.0.0/scripts/mcp.js"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
