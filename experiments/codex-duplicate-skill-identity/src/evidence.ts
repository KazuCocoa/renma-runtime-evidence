import { object } from "../../codex-model-freshness/src/contract.js";
export type Asset = {
  alias: "A" | "B";
  path: string;
  name: string;
  description: string;
  pluginId?: string;
};
export const candidates = [
  "name",
  "path",
  "skill",
  "skill_name",
  "skill_path",
  "uri",
  "resourceUri",
  "pluginId",
  "pluginName",
  "packageId",
  "source",
  "scope",
  "description",
  "content",
  "contentHash",
  "digest",
  "id",
  "renma.id",
  "status",
] as const;
export function fields(v: unknown) {
  const o = object(v);
  return candidates.filter((k) => o && Object.hasOwn(o, k));
}
export function listing(v: unknown, assets: Asset[]) {
  const data = object(v)?.data;
  if (!Array.isArray(data)) throw new Error("Listing unavailable");
  const rows = data
    .flatMap((d) => {
      const a = object(d)?.skills;
      return Array.isArray(a) ? a : [];
    })
    .map(object);
  return assets.map((a) => {
    const matches = rows.filter((r) => r?.path === a.path);
    const r = matches[0];
    return {
      asset: a.alias,
      matches: matches.length,
      fields: fields(r),
      nameMatches: r?.name === a.name,
      descriptionMatches: r?.description === a.description,
      enabled: r?.enabled === true,
      pluginIdMatches:
        a.pluginId === undefined ? null : r?.pluginId === a.pluginId,
    };
  });
}
export function metricProjection(v: unknown, assets: Asset[]) {
  const rs = object(v)?.resourceMetrics;
  const out: unknown[] = [];
  if (!Array.isArray(rs)) return out;
  for (const r of rs)
    for (const s of Array.isArray(object(r)?.scopeMetrics)
      ? (object(r)!.scopeMetrics as unknown[])
      : [])
      for (const m of Array.isArray(object(s)?.metrics)
        ? (object(s)!.metrics as unknown[])
        : []) {
        if (object(m)?.name !== "codex.skill.injected") continue;
        const points = object(object(m)?.sum)?.dataPoints;
        for (const p of Array.isArray(points) ? points : []) {
          const attrs = object(p)?.attributes;
          if (!Array.isArray(attrs)) continue;
          const labels = attrs.map(object).filter((a) => a?.key === "skill");
          const label = labels.length === 1 ? labels[0] : undefined;
          const raw = object(label?.value)?.stringValue;
          const allowed = [
            "code-review",
            ...assets.map((a) => a.name.replace(":", "_")),
          ];
          const providerLabel =
            typeof raw === "string" && allowed.includes(raw)
              ? raw
              : "unrecognized";
          const projection = (as: unknown) =>
            Array.isArray(as)
              ? as
                  .map(object)
                  .flatMap((a) =>
                    typeof a?.key === "string" &&
                    candidates.includes(a.key as (typeof candidates)[number])
                      ? [a.key]
                      : [],
                  )
              : [];
          const value = object(p)?.asInt ?? object(p)?.asDouble;
          out.push({
            providerLabel,
            matchingAssets: assets
              .filter((a) => raw === a.name.replace(":", "_"))
              .map((a) => a.alias),
            attributeFields: projection(attrs),
            resourceFields: projection(object(object(r)?.resource)?.attributes),
            scopeFields: fields(object(s)?.scope),
            value:
              typeof value === "number" &&
              Number.isSafeInteger(value) &&
              value >= 0
                ? value
                : typeof value === "string" && /^\d{1,8}$/.test(value)
                  ? Number(value)
                  : null,
          });
        }
      }
  return out;
}
export function observer(assets: Asset[]) {
  const events: unknown[] = [];
  return {
    events,
    observe(v: unknown) {
      const m = object(v);
      if (
        !["item/started", "item/completed", "skills/changed"].includes(
          typeof m?.method === "string" ? m.method : "",
        )
      )
        return;
      const item = object(object(m?.params)?.item);
      const knownTypes = [
        "userMessage",
        "agentMessage",
        "reasoning",
        "commandExecution",
        "fileChange",
        "mcpToolCall",
        "dynamicToolCall",
      ];
      const type =
        typeof item?.type === "string" && knownTypes.includes(item.type)
          ? item.type
          : "other";
      // No body, command, tool output, arbitrary field names, or runtime IDs retained.
      const knownPathAssets = assets
        .filter((a) => item?.path === a.path)
        .map((a) => a.alias);
      events.push({
        method: m?.method,
        type,
        fields: fields(item),
        knownPathAssets,
      });
    },
  };
}

/** Diagnostic field availability only; never retain log/span bodies or values. */
export function diagnosticProjection(v: unknown, assets: Asset[]) {
  const root = object(v);
  const out: unknown[] = [];
  for (const [channel, resourceKey, scopeKey, recordKey] of [
    ["logs", "resourceLogs", "scopeLogs", "logRecords"],
    ["traces", "resourceSpans", "scopeSpans", "spans"],
  ] as const) {
    const rs = root?.[resourceKey];
    if (!Array.isArray(rs)) continue;
    for (const r of rs) {
      const scopes = object(r)?.[scopeKey];
      if (!Array.isArray(scopes)) continue;
      for (const s of scopes) {
        const records = object(s)?.[recordKey];
        if (!Array.isArray(records)) continue;
        for (const record of records) {
          const attrs = object(record)?.attributes;
          if (!Array.isArray(attrs)) continue;
          const known = attrs
            .map(object)
            .filter(
              (a) =>
                typeof a?.key === "string" &&
                candidates.includes(a.key as (typeof candidates)[number]),
            );
          out.push({
            channel,
            attributeFields: known.map((a) => a!.key),
            knownPathAssets: assets
              .filter((a) =>
                known.some((k) => object(k?.value)?.stringValue === a.path),
              )
              .map((a) => a.alias),
            knownNameAssets: assets
              .filter((a) =>
                known.some((k) => object(k?.value)?.stringValue === a.name),
              )
              .map((a) => a.alias),
            ignoredAttributeCount: attrs.length - known.length,
          });
        }
      }
    }
  }
  return out;
}
