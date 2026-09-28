import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  freezeManifest,
  resolveCandidates,
  type Entry,
} from "../src/provenance.js";

async function evidence() {
  return JSON.parse(
    await readFile(
      "experiments/local-telemetry-system/results/20260928-sync.json",
      "utf8",
    ),
  );
}
const label = "renma-usage-fixture_renma-usage-alpha";

test("actual synchronized Git/Renma evidence distinguishes source commit from content", async () => {
  const r = await evidence();
  const rows: Entry[] = r.manifest;
  const alpha = rows.filter((row) => row.repository === "repository-a");
  assert.equal(r.checks.length, 8);
  assert.ok(
    r.checks.every(
      (c: {
        cloneHeadMatchesSource: boolean;
        catalogIdAndDigestMatch: boolean;
        packagedBytesMatch: boolean;
      }) =>
        c.cloneHeadMatchesSource &&
        c.catalogIdAndDigestMatch &&
        c.packagedBytesMatch,
    ),
  );
  assert.notEqual(alpha[0]!.sourceCommit, alpha[1]!.sourceCommit);
  assert.equal(alpha[0]!.contentDigest, alpha[1]!.contentDigest);
  assert.notEqual(alpha[1]!.contentDigest, alpha[2]!.contentDigest);
  assert.equal(alpha[2]!.sourceCommit, alpha[3]!.sourceCommit);
  assert.notEqual(alpha[2]!.contentDigest, alpha[3]!.contentDigest);
  assert.equal(alpha[3]!.commitMatchesContent, false);
  assert.deepEqual(
    r.resolution.map((value: { state: string }) => value.state),
    [
      "unique-deployment",
      "equivalent-content",
      "ambiguous-content",
      "modified-deployment",
      "unmapped",
    ],
  );
});

test("candidate binding is immutable, strips extras and never resolves a missing candidate", async () => {
  const rows: Entry[] = (await evidence()).manifest;
  const input = rows.map((row) => ({ ...row, rawPrompt: "SECRET" }));
  const bound = freezeManifest(input);
  input[0]!.sourceCommit = "a".repeat(40);
  assert.notEqual(bound[0]!.sourceCommit, input[0]!.sourceCommit);
  assert.ok(!JSON.stringify(bound).includes("SECRET"));
  assert.ok(Object.isFrozen(bound) && bound.every(Object.isFrozen));
  assert.throws(() => freezeManifest([...rows, rows[0]!]));
  assert.throws(() =>
    freezeManifest([{ ...rows[0]!, sourceCommit: "unknown" }]),
  );
  const missing = resolveCandidates(
    rows.filter((row) => row.deployment !== "changed"),
    ["initial", "changed"],
    label,
  );
  assert.equal(missing.state, "unmapped");
  assert.equal(missing.assetId, null);
  const ambiguous = resolveCandidates(rows, ["initial", "changed"], label);
  assert.equal(ambiguous.state, "ambiguous-content");
  assert.equal(ambiguous.assetId, "skill.fixture-alpha");
  assert.equal(ambiguous.contentDigest, null);
  assert.equal(ambiguous.injectedRevision, "unsupported");
  assert.equal(
    resolveCandidates(rows, ["initial", "same-content"], label).state,
    "equivalent-content",
  );
});
