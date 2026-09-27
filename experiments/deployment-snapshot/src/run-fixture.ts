import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bindDeploymentSnapshot,
  compareFixtureContent,
  deploymentEntry,
  FIXTURE_ASSETS,
  fixtureCatalog,
  resolveDeploymentCandidate,
} from "./manifest.js";

export async function runDeploymentFixture() {
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
  // Only the validated commit identifier is retained, never Git diagnostics.
  const commit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 128,
  }).trim();
  const temporary = await mkdtemp(join(tmpdir(), "renma-deployment-fixture-"));
  try {
    const path = join(temporary, "SKILL.md");
    await writeFile(path, a, { mode: 0o600 });
    const entryA = deploymentEntry(catalog, FIXTURE_ASSETS[0], "a", "a");
    const boundA = bindDeploymentSnapshot(catalog, [entryA], commit);
    // A real local file replacement, but no agent runtime or remote cache.
    await writeFile(path, b, { mode: 0o600 });
    const bytesAfterUpdate = await readFile(path);
    assert.equal(catalog.recognize(bytesAfterUpdate), "b");
    const entryB = deploymentEntry(catalog, FIXTURE_ASSETS[0], "b", "a");
    const boundB = bindDeploymentSnapshot(catalog, [entryB], commit);
    assert.equal(boundA.entries[0]?.contentDigest, catalog.digests.a);
    assert.notEqual(
      boundA.entries[0]?.contentDigest,
      boundB.entries[0]?.contentDigest,
    );
    const staleListing = compareFixtureContent(catalog, "a", bytesAfterUpdate);
    const cachedPair = compareFixtureContent(catalog, "a", a);
    const collision = bindDeploymentSnapshot(
      catalog,
      [entryA, deploymentEntry(catalog, FIXTURE_ASSETS[1], "b", "b")],
      commit,
    );
    const missing = bindDeploymentSnapshot(catalog, [], commit);
    return Object.freeze({
      schemaVersion: "renma.deployment-fixture-result.v1",
      evidenceClass: "local-filesystem-fixture",
      agentRuntimeInvoked: false,
      runtimeRevisionBinding: "unsupported",
      beforeUpdate: boundA,
      afterUpdate: boundB,
      snapshotSurvivedReplacement: true,
      freshCandidate: resolveDeploymentCandidate(boundB),
      collision: resolveDeploymentCandidate(collision),
      missing: resolveDeploymentCandidate(missing),
      staleListing,
      cachedPair,
      directVersusSkillInvocation: "unsupported",
      duringAgentExecutionUpdate: "not-run",
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
  runDeploymentFixture().then(
    (report) => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`),
    () => {
      process.stderr.write("Deployment fixture failed\n");
      process.exitCode = 1;
    },
  );
}
