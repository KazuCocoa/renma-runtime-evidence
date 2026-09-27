import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LISTING_FIXTURE_NAME } from "../../codex-listing-freshness/src/listing.js";
import { barrierDeployment, barrierFixture } from "../src/barrier.js";
import { createFixtureGit } from "../src/fixture-git.js";
import { exportToFixtureReceiver } from "../src/loopback-export.js";
import { bindRuntimeOtelProjection } from "../src/runtime-otel.js";

const presence = {
  schemaVersion: 1,
  provider: "codex",
  signal: "skill-injected",
  observationScope: "collector-lifetime",
  injectedSkills: [LISTING_FIXTURE_NAME],
  unrecognizedSkillObserved: false,
};

test("actual synthetic Git A/B commits stay wrapper-only through loopback OTLP transport", async () => {
  const root = await mkdtemp(join(tmpdir(), "renma-git-transport-test-"));
  const workspace = join(root, "workspace");
  const home = join(root, "home");
  const skillDirectory = join(
    workspace,
    ".agents/skills",
    LISTING_FIXTURE_NAME,
  );
  try {
    await mkdir(skillDirectory, { recursive: true });
    await mkdir(home);
    const path = join(skillDirectory, "SKILL.md");
    await writeFile(path, barrierFixture("a"));
    const git = await createFixtureGit(workspace, home, process.env);
    const a = await git.commit("a");
    const projection = bindRuntimeOtelProjection(
      barrierDeployment("a"),
      "synthetic-test",
      a,
    );
    await writeFile(path, barrierFixture("b"));
    const b = await git.commit("b");
    assert.notEqual(a.commit, b.commit);
    assert.equal(Object.isFrozen(a), true);
    const packet = projection.project(presence);
    const groups =
      packet.resourceLogs[0]!.scopeLogs[0]!.logRecords[0]!.body.kvlistValue
        .values;
    const provider = JSON.stringify(groups[0]);
    const wrapper = JSON.stringify(groups[1]);
    assert.equal(provider.includes(a.commit), false);
    assert.equal(provider.includes(b.commit), false);
    assert.equal(wrapper.includes(a.commit), true);
    assert.equal(wrapper.includes(b.commit), false);
    assert.equal(wrapper.includes(barrierDeployment("b").digest), false);
    const receipt = await exportToFixtureReceiver(packet);
    assert.equal(receipt.exactReducedPacketReceived, true);
    assert.equal(receipt.backendInteroperabilityClaimed, false);
    assert.throws(() =>
      bindRuntimeOtelProjection(barrierDeployment("a"), "synthetic-test", b),
    );
    await assert.rejects(
      createFixtureGit(workspace, home, process.env),
      /must be new/,
    );
    await writeFile(path, "PRIVATE_UNRECOGNIZED_CONTENT");
    await assert.rejects(git.commit("a"), /bytes do not match/);
    assert.equal(
      JSON.stringify(
        projection.project({ ...presence, injectedSkills: [] }),
      ).includes(a.commit),
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
