export const DEPLOYMENTS = [
  "initial",
  "same-content",
  "changed",
  "dirty",
] as const;
export type Deployment = (typeof DEPLOYMENTS)[number];
export interface Entry {
  deployment: Deployment;
  repository: "repository-a" | "repository-b";
  assetId: "skill.fixture-alpha" | "skill.fixture-beta";
  skill: "renma-usage-alpha" | "renma-usage-beta";
  plugin: "renma-usage-fixture";
  sourceCommit: string;
  contentDigest: string;
  commitMatchesContent: boolean;
  digestScope: "skill-file";
}
export function freezeManifest(input: readonly Entry[]) {
  if (!input.length || input.length > 16) throw new Error("Manifest size");
  const keys = new Set<string>();
  const rows = input.map((row) => {
    const alpha =
      row.repository === "repository-a" &&
      row.assetId === "skill.fixture-alpha" &&
      row.skill === "renma-usage-alpha";
    const beta =
      row.repository === "repository-b" &&
      row.assetId === "skill.fixture-beta" &&
      row.skill === "renma-usage-beta";
    if (
      !DEPLOYMENTS.includes(row.deployment) ||
      !(alpha || beta) ||
      row.plugin !== "renma-usage-fixture" ||
      typeof row.sourceCommit !== "string" ||
      typeof row.contentDigest !== "string" ||
      !/^[a-f0-9]{40}$/.test(row.sourceCommit) ||
      !/^sha256:[a-f0-9]{64}$/.test(row.contentDigest) ||
      typeof row.commitMatchesContent !== "boolean" ||
      row.digestScope !== "skill-file"
    )
      throw new Error("Unknown manifest value");
    const key = `${row.deployment}:${row.skill}`;
    if (keys.has(key)) throw new Error("Duplicate identity");
    keys.add(key);
    // Reconstruct: no path, arbitrary metadata, or extra input property survives.
    return Object.freeze({
      deployment: row.deployment,
      repository: row.repository,
      assetId: row.assetId,
      skill: row.skill,
      plugin: row.plugin,
      sourceCommit: row.sourceCommit,
      contentDigest: row.contentDigest,
      commitMatchesContent: row.commitMatchesContent,
      digestScope: row.digestScope,
    });
  });
  return Object.freeze(rows);
}
export function resolveCandidates(
  manifest: readonly Entry[],
  candidates: readonly Deployment[],
  label: string,
) {
  const rows = freezeManifest(manifest);
  if (
    !candidates.length ||
    candidates.length > 4 ||
    new Set(candidates).size !== candidates.length ||
    candidates.some((c) => !DEPLOYMENTS.includes(c))
  )
    throw new Error("Invalid deployment candidates");
  const skill = ["renma-usage-alpha", "renma-usage-beta"].find(
    (name) =>
      label === `renma-usage-fixture_${name}` ||
      label === `renma-usage-fixture:${name}`,
  );
  const matches = rows.filter(
    (row) => row.skill === skill && candidates.includes(row.deployment),
  );
  // Missing a candidate mapping must not masquerade as a unique result.
  const complete = candidates.every((candidate) =>
    matches.some((row) => row.deployment === candidate),
  );
  const state =
    !complete || !matches.length
      ? "unmapped"
      : matches.some((row) => !row.commitMatchesContent)
        ? "modified-deployment"
        : matches.length === 1
          ? "unique-deployment"
          : new Set(matches.map((row) => row.contentDigest)).size === 1
            ? "equivalent-content"
            : "ambiguous-content";
  return {
    state,
    assetId: complete && matches.length ? matches[0]!.assetId : null,
    contentDigest:
      complete &&
      matches.length &&
      new Set(matches.map((row) => row.contentDigest)).size === 1
        ? matches[0]!.contentDigest
        : null,
    candidates: matches,
    injectedRevision: "unsupported" as const,
    provenance: "verified-sync-manifest" as const,
  };
}
