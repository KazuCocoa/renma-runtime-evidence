import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execute = promisify(execFile);
const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "../..");
const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";

async function listFiles(root: string, directory = root): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(root, entryPath)));
    } else {
      files.push(relative(root, entryPath).split(sep).join("/"));
    }
  }
  return files.sort();
}

function isAllowedPackageFile(path: string): boolean {
  return (
    path === "package.json" ||
    path === "README.md" ||
    path === "schema/codex-skill-presence-snapshot.schema.json" ||
    /^\.build\/src\/[a-z0-9-]+\.(?:d\.ts|js)$/u.test(path)
  );
}

test("packed private dependency is self-contained and privacy-bounded", async () => {
  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "renma-runtime-evidence-package-"),
  );

  try {
    const artifactDirectory = join(temporaryRoot, "artifact");
    const consumerDirectory = join(temporaryRoot, "consumer");
    await Promise.all([
      mkdir(artifactDirectory, { recursive: true }),
      mkdir(consumerDirectory, { recursive: true }),
    ]);

    await execute(
      npmExecutable,
      ["pack", "--silent", "--pack-destination", artifactDirectory],
      {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          npm_config_audit: "false",
          npm_config_fund: "false",
          npm_config_update_notifier: "false",
        },
      },
    );
    const artifacts = (await readdir(artifactDirectory)).filter((name) =>
      name.endsWith(".tgz"),
    );
    assert.equal(artifacts.length, 1);
    const artifactName = artifacts[0];
    assert.ok(artifactName);
    const artifactPath = join(artifactDirectory, artifactName);

    await writeFile(
      join(consumerDirectory, "package.json"),
      `${JSON.stringify(
        { name: "private-package-consumer", private: true, type: "module" },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await execute(
      npmExecutable,
      [
        "install",
        "--silent",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        artifactPath,
      ],
      {
        cwd: consumerDirectory,
        env: {
          ...process.env,
          npm_config_update_notifier: "false",
        },
      },
    );

    const installedPackage = join(
      consumerDirectory,
      "node_modules/@renma/runtime-evidence",
    );
    const { stdout } = await execute(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        "const api = await import('@renma/runtime-evidence'); process.stdout.write(JSON.stringify(Object.keys(api).sort()));",
      ],
      { cwd: consumerDirectory },
    );
    assert.deepEqual(JSON.parse(stdout) as unknown, [
      "createCodexSkillEvidenceCollector",
    ]);

    await Promise.all([
      access(join(installedPackage, ".build/src/index.js")),
      access(join(installedPackage, ".build/src/index.d.ts")),
      access(join(installedPackage, ".build/src/codex-skill-evidence.js")),
      access(join(installedPackage, ".build/src/codex-skill-evidence.d.ts")),
      access(
        join(
          installedPackage,
          "schema/codex-skill-presence-snapshot.schema.json",
        ),
      ),
      access(join(installedPackage, "README.md")),
    ]);

    const packageFiles = await listFiles(installedPackage);
    assert.equal(
      packageFiles.every(isAllowedPackageFile),
      true,
      packageFiles.join("\n"),
    );
    for (const prohibitedPattern of [
      /(^|\/)tests?\//u,
      /(^|\/)experiments?\//u,
      /(^|\/)evidence\//u,
      /(^|\/)\.local(?:\/|$)/u,
      /(^|\/)\.env(?:\.|$)/u,
      /credential|secret|token|\.pem$|\.key$/iu,
    ]) {
      assert.equal(
        packageFiles.some((path) => prohibitedPattern.test(path)),
        false,
      );
    }

    const installedPackageJson = JSON.parse(
      await readFile(join(installedPackage, "package.json"), "utf8"),
    ) as { private?: unknown; scripts?: { prepare?: unknown } };
    assert.equal(installedPackageJson.private, true);
    assert.equal(installedPackageJson.scripts?.prepare, "npm run build");
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
