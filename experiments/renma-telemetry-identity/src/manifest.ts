export interface Mapping {
  deployment: "before" | "after";
  repository: "repository-a" | "repository-b";
  assetId: string;
  plugin: string;
  name: string;
  version: string;
  digest: string;
}
/** Explicit packaging provenance, never a provider assertion about injected bytes. */
export function manifest(rows: readonly Mapping[]) {
  const labels = new Set<string>(),
    ids = new Set<string>();
  for (const row of rows) {
    if (
      !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(row.assetId) ||
      !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(row.plugin) ||
      !/^[a-z0-9][a-z0-9-]{0,79}$/.test(row.name) ||
      !/^\d+\.\d+\.\d+$/.test(row.version) ||
      !/^sha256:[a-f0-9]{64}$/.test(row.digest)
    )
      throw new Error("Invalid manifest field");
    const label = `${row.deployment}:${row.plugin}_${row.name}`;
    const id = `${row.deployment}:${row.plugin}:${row.assetId}`;
    if (labels.has(label) || ids.has(id))
      throw new Error("Ambiguous deployment identity");
    labels.add(label);
    ids.add(id);
  }
  const copied = Object.freeze(
    rows.map((r) =>
      Object.freeze({
        ...r,
        providerLabelCandidate: `${r.plugin}_${r.name}`,
      }),
    ),
  );
  return {
    rows: copied,
    resolve: (deployment: Mapping["deployment"], label: string) => {
      const matches = copied.filter(
        (r) =>
          r.deployment === deployment && r.providerLabelCandidate === label,
      );
      return matches.length === 1
        ? {
            assetId: matches[0]!.assetId,
            repository: matches[0]!.repository,
            provenance: "packaging-manifest" as const,
            injectedRevision: "unsupported" as const,
          }
        : null;
    },
  };
}
