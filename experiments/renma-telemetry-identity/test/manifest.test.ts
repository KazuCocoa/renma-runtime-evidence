import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { manifest, type Mapping } from "../src/manifest.js";

test("real Renma catalog retains canonical identity through Git rename, plugin move and byte update", async () => {
  const r = JSON.parse(
    await readFile(
      "experiments/renma-telemetry-identity/results/20260928-renma-0.39.2.json",
      "utf8",
    ),
  );
  assert.equal(r.renmaVersion, "0.39.2");
  assert.equal(r.nestedIdRecognized, false);
  assert.equal(r.observations.length, 4);
  assert.ok(
    r.observations.every(
      (o: {
        explicitIdRecognized: boolean;
        contentHashMatched: boolean;
        packagedBytesMatch: boolean;
        catalogExit: number;
      }) =>
        o.explicitIdRecognized &&
        o.contentHashMatched &&
        o.packagedBytesMatch &&
        o.catalogExit === 0,
    ),
  );
  const m = manifest(r.manifest);
  const alpha = m.rows.filter((row) => row.assetId === "skill.fixture-alpha");
  assert.equal(alpha.length, 2);
  assert.notEqual(alpha[0]!.name, alpha[1]!.name);
  assert.notEqual(alpha[0]!.plugin, alpha[1]!.plugin);
  assert.notEqual(alpha[0]!.digest, alpha[1]!.digest);
  assert.notEqual(alpha[0]!.version, alpha[1]!.version);
  assert.equal(r.duplicateNameRejected, true);
  for (const resolution of r.resolution)
    assert.deepEqual(
      m.resolve(resolution.deployment, resolution.label),
      resolution.resolved,
    );
  assert.equal(m.resolve("after", alpha[0]!.providerLabelCandidate), null);
});

test("same plugin/name in different repositories cannot silently select an asset", () => {
  const row: Mapping = {
    deployment: "before",
    repository: "repository-a",
    assetId: "skill.one",
    plugin: "bundle",
    name: "alpha",
    version: "1.0.0",
    digest: `sha256:${"a".repeat(64)}`,
  };
  assert.throws(
    () =>
      manifest([
        row,
        { ...row, repository: "repository-b", assetId: "skill.two" },
      ]),
    /Ambiguous/,
  );
  const m = manifest([
    row,
    { ...row, deployment: "after", assetId: "skill.replacement" },
  ]);
  assert.equal(m.resolve("before", "bundle_alpha")?.assetId, "skill.one");
  assert.equal(
    m.resolve("after", "bundle_alpha")?.assetId,
    "skill.replacement",
  );
  assert.equal(m.resolve("before", "unknown"), null);
});
