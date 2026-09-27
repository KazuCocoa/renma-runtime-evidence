import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  bindDeploymentSnapshot,
  compareFixtureContent,
  deploymentEntry,
  FIXTURE_ASSETS,
  FIXTURE_NAME,
  fixtureCatalog,
  resolveDeploymentCandidate,
  type DeploymentEntry,
} from "../src/manifest.js";
import { runDeploymentFixture } from "../src/run-fixture.js";

const root = resolve(fileURLToPath(new URL("../../../..", import.meta.url)));
const [a, b] = await Promise.all(
  ["a", "b"].map((revision) =>
    readFile(
      resolve(
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

test("fixtures share explicit identity and name while their exact bytes differ", () => {
  for (const bytes of [a, b]) {
    assert.ok(bytes.toString().includes(`name: ${FIXTURE_NAME}\n`));
    assert.ok(bytes.toString().includes(`renma.id: ${FIXTURE_ASSETS[0]}\n`));
  }
  assert.notEqual(catalog.digests.a, catalog.digests.b);
  assert.equal(
    catalog.recognize(Buffer.from("PRIVATE_UNKNOWN_CONTENT")),
    undefined,
  );
});

test("snapshots copy and freeze nested caller inputs; extra content is discarded", () => {
  const entry = {
    ...deploymentEntry(catalog, FIXTURE_ASSETS[0], "a", "a"),
    privatePayload: "PRIVATE_PAYLOAD",
  };
  const input = [entry];
  const snapshot = bindDeploymentSnapshot(catalog, input, null);
  entry.contentDigest = catalog.digests.b;
  input.pop();
  assert.equal(snapshot.entries[0]?.contentDigest, catalog.digests.a);
  assert.equal(JSON.stringify(snapshot).includes("PRIVATE"), false);
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.entries));
  assert.ok(Object.isFrozen(snapshot.entries[0]));
  assert.ok(Object.isFrozen(snapshot.sourceRevision));
});

test("same-name and duplicate candidates are ambiguous and never choose a revision", () => {
  const first = deploymentEntry(catalog, FIXTURE_ASSETS[0], "a", "a");
  const second = deploymentEntry(catalog, FIXTURE_ASSETS[1], "b", "b");
  for (const entries of [
    [first, second],
    [first, first],
  ]) {
    const candidate = resolveDeploymentCandidate(
      bindDeploymentSnapshot(catalog, entries, null),
    );
    assert.equal(candidate.resolution, "ambiguous");
    assert.equal(candidate.deployment, null);
    assert.equal(candidate.injectedRevision, "unsupported");
  }
});

test("unique deployment candidate does not imply injected revision; missing remains unmapped", () => {
  const candidate = resolveDeploymentCandidate(
    bindDeploymentSnapshot(
      catalog,
      [deploymentEntry(catalog, FIXTURE_ASSETS[0], "a", undefined)],
      null,
    ),
  );
  assert.equal(candidate.resolution, "unique-deployment-candidate");
  assert.equal(candidate.deployment?.localState, "unknown");
  assert.equal(candidate.injectedRevision, "unsupported");
  assert.equal(
    resolveDeploymentCandidate(bindDeploymentSnapshot(catalog, [], null))
      .resolution,
    "unmapped",
  );
});

test("digest equality and inequality both leave remote freshness and cause inconclusive", () => {
  const matching = compareFixtureContent(catalog, "a", a!);
  const mismatch = compareFixtureContent(catalog, "a", b!);
  const unknown = compareFixtureContent(
    catalog,
    "a",
    Buffer.from("PRIVATE_UNKNOWN"),
  );
  assert.equal(matching.contentComparison, "matches-listing");
  assert.equal(mismatch.contentComparison, "differs-from-listing");
  assert.equal(unknown.contentComparison, "unrecognized-content");
  for (const result of [matching, mismatch, unknown]) {
    assert.equal(result.freshness, "inconclusive");
    assert.equal(result.cause, "inconclusive");
    assert.equal(JSON.stringify(result).includes("PRIVATE"), false);
  }
});

test("entry and revision validation fails without disclosing unknown inputs", () => {
  const entry = deploymentEntry(catalog, FIXTURE_ASSETS[0], "a", "a");
  for (const change of [
    { assetId: "/private/user/file" },
    { skillName: "PRIVATE" },
    { contentDigest: "sha256:PRIVATE" },
    { digestScope: "PRIVATE" },
    { localState: "PRIVATE" },
  ]) {
    assert.throws(
      () =>
        bindDeploymentSnapshot(
          catalog,
          [{ ...entry, ...change } as DeploymentEntry],
          null,
        ),
      { message: "Invalid fixture snapshot entry" },
    );
  }
  assert.throws(() => bindDeploymentSnapshot(catalog, [entry], "PRIVATE"), {
    message: "Invalid fixture snapshot",
  });
});

test("real filesystem replacement preserves the earlier binding without claiming an agent run", async () => {
  const result = await runDeploymentFixture();
  assert.equal(result.evidenceClass, "local-filesystem-fixture");
  assert.equal(result.agentRuntimeInvoked, false);
  assert.equal(
    result.beforeUpdate.entries[0]?.contentDigest,
    catalog.digests.a,
  );
  assert.equal(result.afterUpdate.entries[0]?.contentDigest, catalog.digests.b);
  assert.equal(result.afterUpdate.entries[0]?.localState, "modified");
  assert.equal(
    result.beforeUpdate.sourceRevision.verification,
    "caller-supplied-unverified",
  );
  assert.equal(result.duringAgentExecutionUpdate, "not-run");
  assert.equal(result.actualHostCacheBehavior, "not-run");
  assert.equal(result.directVersusSkillInvocation, "unsupported");
});
