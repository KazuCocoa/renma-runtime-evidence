import assert from "node:assert/strict";
import test from "node:test";
import { runGitDeploymentFixture } from "../src/run-git-fixture.js";

test("actual Git commits, fetch, detached checkout and dirty content preserve evidence boundaries", async () => {
  const result = await runGitDeploymentFixture();
  assert.equal(result.evidenceClass, "local-git-fixture");
  assert.equal(result.agentRuntimeInvoked, false);
  assert.equal(result.networkRemoteUsed, false);
  assert.notEqual(
    result.boundA.sourceRevision.commit,
    result.boundB.sourceRevision.commit,
  );
  assert.notEqual(
    result.boundA.entries[0]?.contentDigest,
    result.boundB.entries[0]?.contentDigest,
  );
  for (const snapshot of [result.boundA, result.boundB]) {
    assert.match(snapshot.sourceRevision.commit!, /^[a-f0-9]{40}$/u);
    assert.equal(
      snapshot.sourceRevision.verification,
      "caller-supplied-unverified",
    );
    assert.equal(snapshot.entries[0]?.localState, "matches-reference");
  }
  for (const observation of [result.verifiedA, result.verifiedB]) {
    assert.equal(observation.provenance, "fixture-git-verifier");
    assert.equal(observation.scope, "one-skill-md-at-verification-time");
    assert.equal(observation.contentComparison, "matches-listing");
    assert.equal(observation.injectedRevision, "unsupported");
  }
  assert.equal(result.fetchMovedLatestWithoutMovingDeployment, true);
  assert.equal(result.latestWouldMislabelPinnedDeployment, true);
  assert.equal(result.priorSnapshotSurvivedCheckout, true);
  assert.equal(result.gitDirtyObserved, true);
  assert.equal(
    result.dirtyComparison.contentComparison,
    "differs-from-listing",
  );
  assert.equal(
    result.unknownComparison.contentComparison,
    "unrecognized-content",
  );
  assert.equal(result.injectedRevision, "unsupported");
  assert.equal(result.actualHostCacheBehavior, "not-run");
  const serialized = JSON.stringify(result);
  for (const forbidden of [
    "UNRECOGNIZED_SYNTHETIC_BYTES",
    "example.invalid",
    "SKILL.md",
    "empty-hooks",
    "sourcePath",
    "toolOutput",
    "HOME",
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});
