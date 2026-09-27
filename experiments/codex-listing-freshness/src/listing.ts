export const LISTING_FIXTURE_NAME = "renma-listing-freshness-fixture";
export const LISTING_DESCRIPTIONS = {
  a: "Synthetic listing metadata revision A.",
  b: "Synthetic listing metadata revision B.",
} as const;

export function listingEnvironment(
  source: NodeJS.ProcessEnv,
  home: string,
  codexHome: string,
  temporary: string,
): NodeJS.ProcessEnv {
  return {
    PATH: source.PATH,
    HOME: home,
    CODEX_HOME: codexHome,
    XDG_CONFIG_HOME: home,
    TMPDIR: temporary,
    RUST_LOG: "off",
    LANG: "C.UTF-8",
  };
}

export function listingServerArguments(): string[] {
  return [
    "app-server",
    "--stdio",
    "--strict-config",
    "-c",
    'cli_auth_credentials_store="file"',
    "-c",
    "analytics.enabled=false",
    "-c",
    'otel.exporter="none"',
    "-c",
    'otel.trace_exporter="none"',
    "-c",
    'otel.metrics_exporter="none"',
    "-c",
    "otel.log_user_prompt=false",
    "-c",
    'history.persistence="none"',
  ];
}

export function listingFixture(
  revision: "a" | "b",
  bodyRevision: "a" | "b" = revision,
): string {
  return `---\nname: ${LISTING_FIXTURE_NAME}\ndescription: ${LISTING_DESCRIPTIONS[revision]}\n---\n\nSynthetic revision ${bodyRevision}. No executable instructions.\n`;
}

export const LISTING_SCENARIOS = [
  "initial-a",
  "body-only-update-default",
  "body-only-update-force",
  "after-update-default",
  "after-update-force",
  "after-removal-default",
  "after-removal-force",
] as const;
export type ListingScenario = (typeof LISTING_SCENARIOS)[number];

export function requireListingOptIn(args: readonly string[]): void {
  if (args.length !== 1 || args[0] !== "--run-listing-only") {
    throw new Error("Listing experiment requires --run-listing-only");
  }
}

const object = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** Raw RPC data is transient: project only exact known fixture predicates. */
export function reduceListingResult(
  input: unknown,
  expectedCwd: string,
  expectedSkillPath: string,
) {
  const result = object(input);
  const data = result?.data;
  if (!Array.isArray(data) || data.length > 16)
    throw new Error("Unsupported listing response");
  const rows = data.map(object).filter((row) => row?.cwd === expectedCwd);
  if (rows.length !== 1) throw new Error("Unsupported listing response");
  const row = rows[0]!;
  if (
    !Array.isArray(row.skills) ||
    row.skills.length > 1024 ||
    !Array.isArray(row.errors)
  ) {
    throw new Error("Unsupported listing response");
  }
  const skills = row.skills.map(object);
  const matches = skills.filter(
    (skill) => skill?.name === LISTING_FIXTURE_NAME,
  );
  const one = matches.length === 1 ? matches[0] : undefined;
  const pathMatches = one?.path === expectedSkillPath;
  return Object.freeze({
    fixtureEntries:
      matches.length === 0 ? "none" : matches.length === 1 ? "one" : "multiple",
    expectedPathMatched: pathMatches,
    metadataRevision: !pathMatches
      ? "unknown"
      : one?.description === LISTING_DESCRIPTIONS.a
        ? "a"
        : one?.description === LISTING_DESCRIPTIONS.b
          ? "b"
          : "unknown",
    enabled:
      typeof one?.enabled === "boolean"
        ? one.enabled
          ? "true"
          : "false"
        : "unknown",
    otherSkillsObserved: skills.some(
      (skill) => skill?.name !== LISTING_FIXTURE_NAME,
    ),
    listingErrorsObserved: row.errors.length > 0,
    bodyRead: "unsupported",
    injectedRevision: "unsupported",
    producerTtl: "unsupported",
  } as const);
}

export function classifyListingRun(
  results: readonly {
    scenario: ListingScenario;
    observation: ReturnType<typeof reduceListingResult>;
  }[],
): "listing-refresh-observed" | "inconclusive" {
  if (
    results.length !== LISTING_SCENARIOS.length ||
    results.some(
      (row, index) =>
        row.scenario !== LISTING_SCENARIOS[index] ||
        row.observation.listingErrorsObserved,
    )
  ) {
    return "inconclusive";
  }
  const initial = results[0]!.observation;
  const bodyDefault = results[1]!.observation;
  const bodyForced = results[2]!.observation;
  const forced = results[4]!.observation;
  const removed = results[6]!.observation;
  return initial.fixtureEntries === "one" &&
    initial.expectedPathMatched &&
    initial.metadataRevision === "a" &&
    [bodyDefault, bodyForced].every(
      (row) =>
        row.fixtureEntries === "one" &&
        row.expectedPathMatched &&
        row.metadataRevision === "a",
    ) &&
    forced.fixtureEntries === "one" &&
    forced.expectedPathMatched &&
    forced.metadataRevision === "b" &&
    removed.fixtureEntries === "none"
    ? "listing-refresh-observed"
    : "inconclusive";
}
