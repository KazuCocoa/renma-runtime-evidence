import { createHash } from "node:crypto";

// Experiment-only vocabulary. These are reviewed synthetic identities, never
// names, paths, or metadata obtained from arbitrary user repositories.
export const FIXTURE_NAME = "renma-freshness-fixture" as const;
export const FIXTURE_ASSETS = [
  "skill.renma-freshness-fixture",
  "skill.renma-freshness-collision",
] as const;
export type FixtureAsset = (typeof FIXTURE_ASSETS)[number];
export type Digest = `sha256:${string}`;
export type Revision = "a" | "b";

export interface DeploymentEntry {
  readonly assetId: FixtureAsset;
  readonly skillName: typeof FIXTURE_NAME;
  readonly contentDigest: Digest;
  readonly digestScope: "exact-skill-md-bytes";
  readonly localState: "matches-reference" | "modified" | "unknown";
}

export interface DeploymentSnapshot {
  readonly schemaVersion: "renma.experimental-deployment-snapshot.v1";
  readonly provenance: "experiment-wrapper";
  readonly repository: "renma-runtime-evidence-fixture";
  readonly sourceRevision: {
    readonly commit: string | null;
    readonly verification: "caller-supplied-unverified";
  };
  readonly entries: readonly DeploymentEntry[];
}

export interface DeploymentCandidate {
  readonly skillName: typeof FIXTURE_NAME;
  readonly resolution: "unique-deployment-candidate" | "ambiguous" | "unmapped";
  readonly deployment: DeploymentEntry | null;
  readonly injectedRevision: "unsupported";
}

function digest(bytes: Uint8Array): Digest {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/** Hash only exact known fixture bytes. Unknown content is never hashed. */
export function fixtureCatalog(a: Uint8Array, b: Uint8Array) {
  const copies = { a: Buffer.from(a), b: Buffer.from(b) };
  if (copies.a.equals(copies.b)) throw new Error("Fixtures must differ");
  const digests = Object.freeze({ a: digest(copies.a), b: digest(copies.b) });
  return Object.freeze({
    digests,
    recognize(bytes: Uint8Array): Revision | undefined {
      if (copies.a.equals(bytes)) return "a";
      if (copies.b.equals(bytes)) return "b";
      return undefined;
    },
  });
}

export type FixtureCatalog = ReturnType<typeof fixtureCatalog>;

/** Explicit projection: never spread caller data into a persisted record. */
export function deploymentEntry(
  catalog: FixtureCatalog,
  assetId: FixtureAsset,
  revision: Revision,
  reference: Revision | undefined,
): DeploymentEntry {
  if (
    !FIXTURE_ASSETS.includes(assetId) ||
    !["a", "b"].includes(revision) ||
    (reference !== undefined && !["a", "b"].includes(reference))
  ) {
    throw new Error("Invalid fixture deployment");
  }
  return Object.freeze({
    assetId,
    skillName: FIXTURE_NAME,
    contentDigest: catalog.digests[revision],
    digestScope: "exact-skill-md-bytes",
    localState:
      reference === undefined
        ? "unknown"
        : revision === reference
          ? "matches-reference"
          : "modified",
  });
}

/** Must be called before a collector/run starts. Copy all nested input state. */
export function bindDeploymentSnapshot(
  catalog: FixtureCatalog,
  entries: readonly DeploymentEntry[],
  sourceCommit: string | null,
): DeploymentSnapshot {
  if (
    (sourceCommit !== null &&
      !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(sourceCommit)) ||
    entries.length > 2
  ) {
    throw new Error("Invalid fixture snapshot");
  }
  const copied = entries.map((entry): DeploymentEntry => {
    if (
      !FIXTURE_ASSETS.includes(entry.assetId) ||
      entry.skillName !== FIXTURE_NAME ||
      !Object.values(catalog.digests).includes(entry.contentDigest) ||
      entry.digestScope !== "exact-skill-md-bytes" ||
      !["matches-reference", "modified", "unknown"].includes(entry.localState)
    ) {
      throw new Error("Invalid fixture snapshot entry");
    }
    return Object.freeze({
      assetId: entry.assetId,
      skillName: FIXTURE_NAME,
      contentDigest: entry.contentDigest,
      digestScope: "exact-skill-md-bytes",
      localState: entry.localState,
    });
  });
  return Object.freeze({
    schemaVersion: "renma.experimental-deployment-snapshot.v1",
    provenance: "experiment-wrapper",
    repository: "renma-runtime-evidence-fixture",
    sourceRevision: Object.freeze({
      commit: sourceCommit,
      verification: "caller-supplied-unverified",
    }),
    entries: Object.freeze(copied),
  });
}

// A name-only provider signal cannot establish loaded bytes, even if this
// deployment contains exactly one candidate. Duplicate rows remain ambiguous.
export function resolveDeploymentCandidate(
  snapshot: DeploymentSnapshot,
): DeploymentCandidate {
  const candidates = snapshot.entries.filter(
    (entry) => entry.skillName === FIXTURE_NAME,
  );
  return Object.freeze({
    skillName: FIXTURE_NAME,
    resolution:
      candidates.length === 1
        ? "unique-deployment-candidate"
        : candidates.length === 0
          ? "unmapped"
          : "ambiguous",
    deployment: candidates.length === 1 ? candidates[0]! : null,
    injectedRevision: "unsupported",
  });
}

export function compareFixtureContent(
  catalog: FixtureCatalog,
  listing: Revision,
  bytes: Uint8Array,
) {
  if (!["a", "b"].includes(listing)) throw new Error("Invalid fixture listing");
  const revision = catalog.recognize(bytes);
  return Object.freeze({
    contentComparison:
      revision === undefined
        ? "unrecognized-content"
        : revision === listing
          ? "matches-listing"
          : "differs-from-listing",
    freshness: "inconclusive",
    cause: "inconclusive",
    producerTtl: "unsupported",
    producerCacheScope: "unsupported",
  } as const);
}
