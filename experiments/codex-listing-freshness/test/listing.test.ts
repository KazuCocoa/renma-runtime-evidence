import assert from "node:assert/strict";
import test from "node:test";
import {
  LISTING_DESCRIPTIONS,
  LISTING_FIXTURE_NAME,
  LISTING_SCENARIOS,
  classifyListingRun,
  listingEnvironment,
  listingServerArguments,
  reduceListingResult,
  requireListingOptIn,
} from "../src/listing.js";

const cwd = "/synthetic/workspace";
const path = "/synthetic/fixture/SKILL.md";
const skill = {
  name: LISTING_FIXTURE_NAME,
  path,
  description: LISTING_DESCRIPTIONS.a,
  enabled: true,
};
const response = (skills: unknown[], errors: unknown[] = []) => ({
  data: [{ cwd, skills, errors }],
});

test("listing child gets isolated homes without credentials and explicitly disabled analytics/exporters", () => {
  const environment = listingEnvironment(
    {
      PATH: "/fixture/bin",
      HOME: "PRIVATE_HOME",
      CODEX_HOME: "PRIVATE_CODEX_HOME",
      CODEX_API_KEY: "PRIVATE_KEY",
      OPENAI_API_KEY: "PRIVATE_OTHER_KEY",
      HTTPS_PROXY: "PRIVATE_PROXY",
      RUST_LOG: "debug",
      GIT_CONFIG_GLOBAL: "PRIVATE_CONFIG",
    },
    "/fixture/home",
    "/fixture/codex",
    "/fixture/tmp",
  );
  assert.deepEqual(environment, {
    PATH: "/fixture/bin",
    HOME: "/fixture/home",
    CODEX_HOME: "/fixture/codex",
    XDG_CONFIG_HOME: "/fixture/home",
    TMPDIR: "/fixture/tmp",
    RUST_LOG: "off",
    LANG: "C.UTF-8",
  });
  assert.equal(JSON.stringify(environment).includes("PRIVATE"), false);
  const args = listingServerArguments();
  assert.equal(args.includes("--analytics-default-enabled"), false);
  for (const required of [
    "analytics.enabled=false",
    'cli_auth_credentials_store="file"',
    'otel.exporter="none"',
    'otel.trace_exporter="none"',
    'otel.metrics_exporter="none"',
    "otel.log_user_prompt=false",
    'history.persistence="none"',
  ]) {
    assert.equal(args.includes(required), true);
  }
});

test("listing runner requires one exact opt-in before any runtime activity", () => {
  assert.doesNotThrow(() => requireListingOptIn(["--run-listing-only"]));
  for (const args of [
    [],
    ["--allow-codex-analytics"],
    ["--run-listing-only", "extra"],
  ]) {
    assert.throws(() => requireListingOptIn(args), {
      message: "Listing experiment requires --run-listing-only",
    });
  }
});

test("listing reduction discards descriptions, paths, errors and arbitrary content", () => {
  const observation = reduceListingResult(
    response(
      [
        {
          ...skill,
          body: "PRIVATE_BODY",
          interface: { description: "PRIVATE_INTERFACE" },
        },
        {
          name: "PRIVATE_NAME",
          path: "PRIVATE_PATH",
          description: "PRIVATE_DESCRIPTION",
        },
      ],
      [{ message: "PRIVATE_ERROR" }],
    ),
    cwd,
    path,
  );
  assert.equal(observation.metadataRevision, "a");
  assert.equal(observation.expectedPathMatched, true);
  assert.equal(observation.otherSkillsObserved, true);
  assert.equal(observation.listingErrorsObserved, true);
  assert.equal(observation.bodyRead, "unsupported");
  assert.equal(observation.injectedRevision, "unsupported");
  assert.equal(JSON.stringify(observation).includes("PRIVATE"), false);
  assert.equal(JSON.stringify(observation).includes("/synthetic"), false);
});

test("same-name collision, unexpected path and unknown metadata do not identify revision", () => {
  for (const skills of [
    [skill, { ...skill }],
    [{ ...skill, path: "PRIVATE_OTHER_PATH" }],
    [{ ...skill, description: "PRIVATE_OTHER_DESCRIPTION" }],
    [],
  ]) {
    const observation = reduceListingResult(response(skills), cwd, path);
    assert.equal(observation.metadataRevision, "unknown");
    assert.equal(JSON.stringify(observation).includes("PRIVATE"), false);
  }
});

test("malformed or mismatched listing response fails with a fixed error", () => {
  for (const input of [
    null,
    {},
    { data: [] },
    { data: [{ cwd: "PRIVATE" }] },
    { data: [{ cwd, skills: "PRIVATE", errors: [] }] },
  ]) {
    assert.throws(() => reduceListingResult(input, cwd, path), {
      message: "Unsupported listing response",
    });
  }
});

test("classification requires actual baseline and forced refresh; default cache behavior is not assumed", () => {
  const a = reduceListingResult(response([skill]), cwd, path);
  const b = reduceListingResult(
    response([{ ...skill, description: LISTING_DESCRIPTIONS.b }]),
    cwd,
    path,
  );
  const absent = reduceListingResult(response([]), cwd, path);
  for (const observations of [
    [a, a, a, a, b, b, absent],
    [a, a, a, b, b, absent, absent],
  ]) {
    const rows = observations.map((observation, index) => ({
      scenario: LISTING_SCENARIOS[index]!,
      observation,
    }));
    assert.equal(classifyListingRun(rows), "listing-refresh-observed");
    assert.equal(classifyListingRun(rows.slice(1)), "inconclusive");
    rows[4] = { scenario: "after-update-force", observation: a };
    assert.equal(classifyListingRun(rows), "inconclusive");
  }
});
