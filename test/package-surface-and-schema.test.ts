import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

type UnknownRecord = Record<string, unknown>;

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "../..");
const schemaPath = join(
  repositoryRoot,
  "schema/codex-skill-presence-snapshot.schema.json",
);

function asRecord(value: unknown): UnknownRecord {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as UnknownRecord;
}

test("publishes only the deliberate runtime API from the package root", async () => {
  const packageSpecifier: string = "@renma/runtime-evidence";
  const publicApi = await import(packageSpecifier);
  assert.deepEqual(Object.keys(publicApi), [
    "createCodexSkillEvidenceCollector",
  ]);

  const packageJson = asRecord(
    JSON.parse(
      await readFile(join(repositoryRoot, "package.json"), "utf8"),
    ) as unknown,
  );
  assert.equal(packageJson.name, "@renma/runtime-evidence");
  assert.equal(packageJson.private, true);
  assert.equal(asRecord(packageJson.scripts).prepare, "npm run build");
  assert.equal(packageJson.main, "./.build/src/index.js");
  assert.equal(packageJson.types, "./.build/src/index.d.ts");
  const packageExports = asRecord(packageJson.exports);
  assert.deepEqual(Object.keys(packageExports).sort(), [
    ".",
    "./schema/codex-skill-presence-snapshot.schema.json",
  ]);
  assert.equal(
    packageExports["./schema/codex-skill-presence-snapshot.schema.json"],
    "./schema/codex-skill-presence-snapshot.schema.json",
  );
});

test("generates declarations for the complete public TypeScript surface", async () => {
  const [declarations, implementationDeclarations] = await Promise.all([
    readFile(join(repositoryRoot, ".build/src/index.d.ts"), "utf8"),
    readFile(
      join(repositoryRoot, ".build/src/codex-skill-evidence.d.ts"),
      "utf8",
    ),
  ]);
  for (const publicName of [
    "createCodexSkillEvidenceCollector",
    "CodexSkillEvidenceCollector",
    "CodexSkillEvidenceCollectorOptions",
    "CodexSkillEvidenceDiagnosticsSnapshot",
    "CodexSkillPresenceSnapshot",
  ]) {
    assert.equal(declarations.includes(publicName), true);
  }
  assert.equal(declarations.includes("MAX_REQUEST_BYTES"), false);
  assert.equal(declarations.includes("parseRequestObservation"), false);
  assert.equal(declarations.includes("raw"), false);
  assert.equal(implementationDeclarations.includes("MAX_REQUEST_BYTES"), false);
  assert.equal(
    implementationDeclarations.includes("SHUTDOWN_GRACE_PERIOD_MS"),
    false,
  );
});

test("strict snapshot schema fixes the finite public contract", async () => {
  const schema = asRecord(
    JSON.parse(await readFile(schemaPath, "utf8")) as unknown,
  );
  assert.equal(schema.type, "object");
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, [
    "schemaVersion",
    "provider",
    "signal",
    "observationScope",
    "injectedSkills",
    "unrecognizedSkillObserved",
  ]);

  const properties = asRecord(schema.properties);
  assert.equal(asRecord(properties.schemaVersion).const, 1);
  assert.equal(asRecord(properties.provider).const, "codex");
  assert.equal(asRecord(properties.signal).const, "skill-injected");
  assert.equal(
    asRecord(properties.observationScope).const,
    "collector-lifetime",
  );
  assert.deepEqual(asRecord(properties.unrecognizedSkillObserved), {
    description:
      "True only when an otherwise valid, recorded, strictly positive exact status=ok counter datapoint contained a Skill string outside the caller allowlist; that string is not retained.",
    type: "boolean",
  });

  const injectedSkills = asRecord(properties.injectedSkills);
  assert.equal(injectedSkills.type, "array");
  assert.equal(injectedSkills.minItems, 0);
  assert.equal(injectedSkills.maxItems, 128);
  assert.equal(injectedSkills.uniqueItems, true);
  assert.equal(injectedSkills["x-sorted"], true);
  const skillName = asRecord(injectedSkills.items);
  assert.equal(skillName.type, "string");
  assert.equal(skillName.minLength, 1);
  assert.equal(skillName.maxLength, 256);
  assert.equal(skillName.pattern, "^[^\\u0000-\\u001F\\u007F-\\u009F]+$");
  assert.match(String(skillName.$comment), /1024 UTF-8 bytes/);
  assert.equal("unknownSkill" in properties, false);
  assert.equal("count" in properties, false);
  assert.equal("timestamp" in properties, false);
});

test("README and decision document state the private provider boundary", async () => {
  const [readme, decision] = await Promise.all([
    readFile(join(repositoryRoot, "README.md"), "utf8"),
    readFile(
      join(
        repositoryRoot,
        "docs/decisions/0001-codex-skill-injection-presence.md",
      ),
      "utf8",
    ),
  ]);
  assert.match(readme, /initial private, pre-release library API/);
  assert.match(readme, /`"private": true`/);
  assert.match(readme, /collector-lifetime presence/);
  assert.match(readme, /valid, recorded, strictly positive datapoint/);
  assert.match(readme, /supported private consumption path/);
  assert.match(readme, /github:KazuCocoa\/renma-runtime-evidence/);
  assert.match(decision, /first public API is explicitly Codex-specific/);
  assert.match(decision, /no OTLP `NO_RECORDED_VALUE` marker/);
  assert.match(decision, /does not call the evidence read, executed, selected/);
  assert.match(decision, /Renma owns statically declared Skill dependencies/);
  assert.match(decision, /does not invoke Renma/);
  assert.match(decision, /never writes a snapshot automatically/);
});
