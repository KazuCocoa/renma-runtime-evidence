import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bindDeploymentSnapshot,
  compareFixtureContent,
  deploymentEntry,
  FIXTURE_ASSETS,
  FIXTURE_NAME,
  fixtureCatalog,
  type FixtureCatalog,
  type Revision,
} from "./manifest.js";

const SKILL_PATH = `skills/${FIXTURE_NAME}/SKILL.md`;
const MAX_GIT_OUTPUT = 16 * 1024;

function isolatedGit(environment: NodeJS.ProcessEnv) {
  return (cwd: string, args: readonly string[]): Buffer => {
    try {
      return execFileSync("git", [...args], {
        cwd,
        env: environment,
        timeout: 10_000,
        maxBuffer: MAX_GIT_OUTPUT,
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      // Do not expose subprocess errors, arguments, paths, or diagnostics.
      throw new Error("Synthetic Git operation failed");
    }
  };
}

function commitIdentifier(bytes: Buffer): string {
  const value = bytes.toString("ascii").trim();
  if (!/^[a-f0-9]{40}$/u.test(value)) throw new Error("Invalid fixture commit");
  return value;
}

/** Compares exact known fixture bytes; never digests unrecognized data. */
export function verifyFixtureGitContent(
  catalog: FixtureCatalog,
  expected: Revision,
  deployed: Uint8Array,
) {
  const comparison = compareFixtureContent(catalog, expected, deployed);
  return Object.freeze({
    provenance: "fixture-git-verifier",
    scope: "one-skill-md-at-verification-time",
    contentComparison: comparison.contentComparison,
    injectedRevision: "unsupported",
  } as const);
}

export async function runGitDeploymentFixture() {
  const root = resolve(fileURLToPath(new URL("../../../..", import.meta.url)));
  const [a, b] = await Promise.all(
    ["a", "b"].map((revision) =>
      readFile(
        join(
          root,
          "experiments/deployment-snapshot/fixtures",
          revision,
          "SKILL.md",
        ),
      ),
    ),
  );
  assert.ok(a && b);
  const catalog = fixtureCatalog(a, b);
  const temporary = await mkdtemp(
    join(tmpdir(), "renma-git-deployment-fixture-"),
  );
  try {
    const source = join(temporary, "source");
    const deployment = join(temporary, "deployment");
    const home = join(temporary, "home");
    const hooks = join(temporary, "empty-hooks");
    await Promise.all([source, home, hooks].map((path) => mkdir(path)));
    const environment: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: home,
      XDG_CONFIG_HOME: home,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
      GIT_AUTHOR_NAME: "Renma Fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.invalid",
      GIT_COMMITTER_NAME: "Renma Fixture",
      GIT_COMMITTER_EMAIL: "fixture@example.invalid",
      GIT_AUTHOR_DATE: "2026-09-27T00:00:00Z",
      GIT_COMMITTER_DATE: "2026-09-27T00:00:00Z",
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "core.hooksPath",
      GIT_CONFIG_VALUE_0: hooks,
      GIT_CONFIG_KEY_1: "commit.gpgSign",
      GIT_CONFIG_VALUE_1: "false",
      LC_ALL: "C",
    };
    const git = isolatedGit(environment);
    git(source, [
      "init",
      "--quiet",
      "--template=",
      "--object-format=sha1",
      "--initial-branch=main",
    ]);
    const sourceFile = join(source, SKILL_PATH);
    await mkdir(dirname(sourceFile), { recursive: true });
    await writeFile(sourceFile, a, { mode: 0o600 });
    git(source, ["add", "--", SKILL_PATH]);
    git(source, ["commit", "--quiet", "-m", "Synthetic revision A"]);
    const commitA = commitIdentifier(git(source, ["rev-parse", "HEAD"]));
    git(temporary, [
      "clone",
      "--quiet",
      "--no-hardlinks",
      "--template=",
      source,
      deployment,
    ]);
    git(deployment, ["checkout", "--quiet", "--detach", commitA]);
    const deployedFile = join(deployment, SKILL_PATH);
    const gitBytesA = git(deployment, ["show", `${commitA}:${SKILL_PATH}`]);
    assert.equal(catalog.recognize(gitBytesA), "a");
    const verifiedA = verifyFixtureGitContent(
      catalog,
      "a",
      await readFile(deployedFile),
    );
    assert.equal(verifiedA.contentComparison, "matches-listing");
    const boundA = bindDeploymentSnapshot(
      catalog,
      [deploymentEntry(catalog, FIXTURE_ASSETS[0], "a", "a")],
      commitA,
    );

    // Update the origin, then fetch it. Fetch does not update the pinned worktree.
    await writeFile(sourceFile, b, { mode: 0o600 });
    git(source, ["add", "--", SKILL_PATH]);
    git(source, ["commit", "--quiet", "-m", "Synthetic revision B"]);
    const commitB = commitIdentifier(git(source, ["rev-parse", "HEAD"]));
    assert.notEqual(commitA, commitB);
    git(deployment, ["fetch", "--quiet", "origin"]);
    const latest = commitIdentifier(
      git(deployment, ["rev-parse", "origin/main"]),
    );
    const pinned = commitIdentifier(git(deployment, ["rev-parse", "HEAD"]));
    assert.equal(latest, commitB);
    assert.equal(pinned, commitA);
    assert.equal(catalog.recognize(await readFile(deployedFile)), "a");

    // A second deployment is explicitly checked out before its new binding.
    git(deployment, ["checkout", "--quiet", "--detach", commitB]);
    const gitBytesB = git(deployment, ["show", `${commitB}:${SKILL_PATH}`]);
    assert.equal(catalog.recognize(gitBytesB), "b");
    const verifiedB = verifyFixtureGitContent(
      catalog,
      "b",
      await readFile(deployedFile),
    );
    assert.equal(verifiedB.contentComparison, "matches-listing");
    const boundB = bindDeploymentSnapshot(
      catalog,
      [deploymentEntry(catalog, FIXTURE_ASSETS[0], "b", "b")],
      commitB,
    );
    assert.equal(boundA.entries[0]?.contentDigest, catalog.digests.a);
    assert.equal(boundA.sourceRevision.commit, commitA);

    // HEAD alone does not describe a dirty deployment.
    await writeFile(deployedFile, a, { mode: 0o600 });
    const dirty = spawnSync(
      "git",
      ["diff", "--quiet", "--exit-code", "--", SKILL_PATH],
      {
        cwd: deployment,
        env: environment,
        timeout: 10_000,
        stdio: "ignore",
      },
    );
    assert.equal(dirty.status, 1);
    assert.equal(
      commitIdentifier(git(deployment, ["rev-parse", "HEAD"])),
      commitB,
    );
    const dirtyComparison = verifyFixtureGitContent(
      catalog,
      "b",
      await readFile(deployedFile),
    );
    assert.equal(dirtyComparison.contentComparison, "differs-from-listing");
    await writeFile(deployedFile, "UNRECOGNIZED_SYNTHETIC_BYTES", {
      mode: 0o600,
    });
    const unknownComparison = verifyFixtureGitContent(
      catalog,
      "b",
      await readFile(deployedFile),
    );
    assert.equal(unknownComparison.contentComparison, "unrecognized-content");

    return Object.freeze({
      schemaVersion: "renma.git-deployment-fixture-result.v1",
      evidenceClass: "local-git-fixture",
      agentRuntimeInvoked: false,
      networkRemoteUsed: false,
      boundA,
      boundB,
      verifiedA,
      verifiedB,
      fetchMovedLatestWithoutMovingDeployment: true,
      latestWouldMislabelPinnedDeployment: true,
      priorSnapshotSurvivedCheckout: true,
      gitDirtyObserved: true,
      dirtyComparison,
      unknownComparison,
      injectedRevision: "unsupported",
      actualHostCacheBehavior: "not-run",
    } as const);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runGitDeploymentFixture().then(
    (report) => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`),
    () => {
      process.stderr.write("Git deployment fixture failed\n");
      process.exitCode = 1;
    },
  );
}
