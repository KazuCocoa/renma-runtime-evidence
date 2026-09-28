import { createServer } from "node:http";
import { once } from "node:events";

export const SKILLS = [
  "renma-usage-alpha",
  "renma-usage-beta",
  "renma-usage-dormant",
] as const;
export type Skill = (typeof SKILLS)[number];
const object = (x: unknown): Record<string, unknown> | undefined =>
  typeof x === "object" && x !== null && !Array.isArray(x)
    ? (x as Record<string, unknown>)
    : undefined;
const array = (x: unknown): unknown[] => {
  if (!Array.isArray(x)) throw new Error("Invalid OTLP");
  return x;
};
const record = (x: unknown) => {
  const r = object(x);
  if (!r) throw new Error("Invalid OTLP");
  return r;
};
const nano = (x: unknown): string | null =>
  typeof x === "string" &&
  /^[1-9][0-9]{0,19}$/u.test(x) &&
  BigInt(x) <= (1n << 64n) - 1n
    ? x
    : null;
const DIMENSIONS: Record<string, readonly string[]> = {
  auth_mode: [
    "chatgpt",
    "ChatGPT",
    "Chatgpt",
    "chatgpt_auth_tokens",
    "chatgptAuthTokens",
    "chatgpt-auth-tokens",
    "chatgpt_at",
    "ChatGPTAuthTokens",
    "api_key",
    "apikey",
  ],
  originator: ["renma_usage_fixture", "codex_cli_rs", "codex_app_server"],
  session_source: ["cli", "exec", "app-server", "app_server", "vscode", "sdk"],
  model: [
    "gpt-6-astra",
    "gpt-6-sol",
    "gpt-6-luna",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.5",
    "unknown",
    "",
  ],
  "app.version": ["0.157.1"],
  model_slug: [
    "gpt-6-astra",
    "gpt-6-sol",
    "gpt-6-luna",
    "gpt-5.6-sol",
    "gpt-5.5",
  ],
  reasoning_effort: [
    "none",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
    "ultra",
  ],
};
export interface Sample {
  skill: Skill;
  providerSkill: string;
  observedAt: string;
  elapsedMs: number;
  value: number;
  aggregation: "cumulative" | "delta" | "unspecified";
  monotonic: boolean;
  startTimeUnixNano: string | null;
  timeUnixNano: string | null;
  extraDimensions: boolean;
  dimensions: Record<string, string>;
  unsupportedDimensionKinds: string[];
}

/** Reconstruct only the experiment's declared metadata. No resource/scope/body values survive. */
export function reduceMetrics(
  input: unknown,
  observedAt: string,
  elapsedMs: number,
  labelAliases?: ReadonlyMap<string, Skill>,
): {
  samples: Sample[];
  unknownSkillObserved: boolean;
} {
  if (
    !Number.isFinite(Date.parse(observedAt)) ||
    !Number.isFinite(elapsedMs) ||
    elapsedMs < 0
  )
    throw new Error("Invalid clock");
  const samples: Sample[] = [];
  let unknownSkillObserved = false;
  for (const rawResource of array(record(input).resourceMetrics)) {
    for (const rawScope of array(record(rawResource).scopeMetrics)) {
      for (const rawMetric of array(record(rawScope).metrics)) {
        const metric = record(rawMetric);
        if (metric.name !== "codex.skill.injected") continue;
        const sum = record(metric.sum);
        for (const rawPoint of array(sum.dataPoints)) {
          const point = record(rawPoint);
          const attrs = array(point.attributes).map(record);
          const skills = attrs.filter((a) => a.key === "skill");
          const statuses = attrs.filter((a) => a.key === "status");
          if (skills.length !== 1 || statuses.length !== 1)
            throw new Error("Invalid target attributes");
          const providerSkill = object(skills[0]!.value)?.stringValue;
          const skill = labelAliases
            ? labelAliases.get(
                typeof providerSkill === "string" ? providerSkill : "",
              )
            : SKILLS.find(
                (name) =>
                  providerSkill === name ||
                  providerSkill === `renma-usage-fixture:${name}` ||
                  providerSkill === `renma-usage-fixture_${name}`,
              );
          if (!skill) {
            unknownSkillObserved = true;
            continue;
          }
          if (object(statuses[0]!.value)?.stringValue !== "ok") continue;
          if (
            point.flags !== undefined &&
            (!Number.isSafeInteger(point.flags) ||
              Number(point.flags) < 0 ||
              Number(point.flags) > 0xffff_ffff)
          )
            throw new Error("Invalid flags");
          if ((Number(point.flags ?? 0) & 1) !== 0) continue;
          if ((point.asInt === undefined) === (point.asDouble === undefined))
            throw new Error("Invalid counter");
          if (
            point.asDouble !== undefined &&
            typeof point.asDouble !== "number"
          )
            throw new Error("Invalid counter");
          const raw = point.asInt ?? point.asDouble;
          if (
            typeof raw !== "number" &&
            !(typeof raw === "string" && /^[0-9]{1,16}$/u.test(raw))
          )
            throw new Error("Invalid counter");
          const value = Number(raw);
          if (!Number.isSafeInteger(value) || value < 0)
            throw new Error("Invalid counter");
          const dimensions: Record<string, string> = {};
          const unsupportedDimensionKinds = new Set<string>();
          for (const attr of attrs) {
            if (attr.key === "skill" || attr.key === "status") continue;
            const key = typeof attr.key === "string" ? attr.key : "";
            const choices = Object.hasOwn(DIMENSIONS, key)
              ? DIMENSIONS[key]
              : undefined;
            const v = object(attr.value)?.stringValue;
            if (!choices) unsupportedDimensionKinds.add("other");
            else if (
              typeof v !== "string" ||
              !choices.includes(v) ||
              Object.hasOwn(dimensions, key)
            )
              unsupportedDimensionKinds.add(key);
            else dimensions[key] = v;
          }
          samples.push({
            skill,
            providerSkill: providerSkill as string,
            observedAt,
            elapsedMs,
            value,
            aggregation:
              sum.aggregationTemporality === 2
                ? "cumulative"
                : sum.aggregationTemporality === 1
                  ? "delta"
                  : "unspecified",
            monotonic: sum.isMonotonic === true,
            startTimeUnixNano: nano(point.startTimeUnixNano),
            timeUnixNano: nano(point.timeUnixNano),
            extraDimensions: unsupportedDimensionKinds.size > 0,
            dimensions: Object.fromEntries(Object.entries(dimensions).sort()),
            unsupportedDimensionKinds: [...unsupportedDimensionKinds].sort(),
          });
          if (samples.length > 256) throw new Error("Sample limit");
        }
      }
    }
  }
  // Multiple same-label points in a packet can be distinct resource/scope series.
  for (const s of samples)
    if (samples.filter((other) => other.skill === s.skill).length > 1)
      s.extraDimensions = true;
  return {
    samples,
    unknownSkillObserved,
  };
}

/** One dedicated Codex process per collector. Other deployments need producer identity. */
export function summarize(samples: readonly Sample[]) {
  return SKILLS.map((skill) => {
    const rows = samples
      .filter((s) => s.skill === skill)
      .sort((a, b) => a.elapsedMs - b.elapsedMs);
    const positives = rows.filter((s) => s.value > 0);
    const epochs = new Set(rows.map((s) => s.startTimeUnixNano));
    const supported =
      rows.length > 0 &&
      epochs.size === 1 &&
      rows.every(
        (s) =>
          s.providerSkill === rows[0]!.providerSkill &&
          JSON.stringify(s.dimensions) ===
            JSON.stringify(rows[0]!.dimensions) &&
          s.aggregation === "cumulative" &&
          s.monotonic &&
          s.startTimeUnixNano !== null &&
          s.timeUnixNano !== null &&
          BigInt(s.timeUnixNano) >= BigInt(s.startTimeUnixNano) &&
          !s.extraDimensions,
      );
    const ordered = supported
      ? [...rows].sort((a, b) =>
          BigInt(a.timeUnixNano!) < BigInt(b.timeUnixNano!)
            ? -1
            : BigInt(a.timeUnixNano!) > BigInt(b.timeUnixNano!)
              ? 1
              : 0,
        )
      : [];
    const consistent =
      supported &&
      ordered.every(
        (s, i) =>
          i === 0 ||
          (s.value >= ordered[i - 1]!.value &&
            (s.timeUnixNano !== ordered[i - 1]!.timeUnixNano ||
              s.value === ordered[i - 1]!.value)),
      );
    let max = 0;
    let lastIncreaseObservedAt: string | null = null;
    if (consistent)
      for (const s of rows)
        if (s.value > max) {
          max = s.value;
          lastIncreaseObservedAt = s.observedAt;
        }
    const deltaEligible =
      rows.length > 0 &&
      rows.every(
        (s) =>
          s.aggregation === "delta" &&
          s.monotonic &&
          s.startTimeUnixNano !== null &&
          s.timeUnixNano !== null &&
          BigInt(s.timeUnixNano) > BigInt(s.startTimeUnixNano) &&
          s.providerSkill === rows[0]!.providerSkill,
      );
    const unique = new Map<string, Sample>();
    let deltaValid = deltaEligible;
    if (deltaEligible)
      for (const s of rows) {
        const key = `${s.startTimeUnixNano}:${s.timeUnixNano}`;
        const old = unique.get(key);
        if (
          old &&
          (old.value !== s.value ||
            old.extraDimensions ||
            s.extraDimensions ||
            JSON.stringify(old.dimensions) !== JSON.stringify(s.dimensions))
        )
          deltaValid = false;
        else if (!old) unique.set(key, s);
      }
    const intervals = [...unique.values()].sort((a, b) =>
      BigInt(a.startTimeUnixNano!) < BigInt(b.startTimeUnixNano!) ? -1 : 1,
    );
    if (
      intervals.some(
        (s, i) =>
          i > 0 &&
          BigInt(s.startTimeUnixNano!) <
            BigInt(intervals[i - 1]!.timeUnixNano!),
      )
    )
      deltaValid = false;
    const deltaTotal = intervals.reduce((total, s) => total + s.value, 0);
    if (!Number.isSafeInteger(deltaTotal)) deltaValid = false;
    const deltaGap = intervals.some(
      (s, i) =>
        i > 0 &&
        BigInt(s.startTimeUnixNano!) > BigInt(intervals[i - 1]!.timeUnixNano!),
    );
    if (deltaValid)
      lastIncreaseObservedAt =
        [...unique.values()].filter((s) => s.value > 0).at(-1)?.observedAt ??
        null;
    return {
      skill,
      observed: positives.length > 0,
      firstObservedAt: positives[0]?.observedAt ?? null,
      lastReceivedAt: rows.at(-1)?.observedAt ?? null,
      lastIncreaseObservedAt,
      receivedSamples: rows.length,
      providerCounterTotal: consistent ? max : deltaValid ? deltaTotal : null,
      deltaIntervalGapsObserved: deltaEligible ? deltaGap : null,
      coverage: "received-samples-only" as const,
      countStatus:
        rows.length === 0
          ? "no-sample"
          : consistent
            ? "single-producer-cumulative-maximum"
            : deltaValid
              ? rows.some((s) => s.extraDimensions)
                ? "single-producer-disjoint-delta-sum"
                : "single-producer-deduplicated-delta-sum"
              : "unsupported-series",
      injectionTime: "unsupported" as const,
    };
  });
}

export async function createUsageCollector(
  port = 0,
  changed: () => void = () => {},
  sharedHealth = false,
  labelAliases?: ReadonlyMap<string, Skill>,
) {
  const aliases = labelAliases ? new Map(labelAliases) : undefined;
  const samples: Sample[] = [];
  const started = performance.now();
  const startedAt = new Date().toISOString();
  let requests = 0,
    rejectedRequests = 0;
  let unknownSkillObserved = false;
  const server = createServer(async (req, res) => {
    if (sharedHealth && req.method === "GET" && req.url === "/health") {
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ service: "renma-usage-fixture", version: 1 }));
      return;
    }
    if (req.method !== "POST" || req.url !== "/v1/metrics") {
      res.writeHead(404).end();
      req.resume();
      return;
    }
    const observedAt = new Date().toISOString();
    const elapsedMs = Math.round(performance.now() - started);
    let bytes = 0;
    const chunks: Buffer[] = [];
    try {
      if (++requests > 512) throw new Error("Request limit");
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 2 * 1024 * 1024) throw new Error("Request limit");
        chunks.push(chunk);
      }
      const reduced = reduceMetrics(
        JSON.parse(Buffer.concat(chunks).toString("utf8")),
        observedAt,
        elapsedMs,
        aliases,
      );
      if (samples.length + reduced.samples.length > 256)
        throw new Error("Sample limit");
      samples.push(...reduced.samples);
      unknownSkillObserved ||= reduced.unknownSkillObserved;
      res.writeHead(200, { "content-type": "application/json" }).end("{}");
    } catch {
      rejectedRequests = Math.min(513, rejectedRequests + 1);
      res.writeHead(400).end();
    } finally {
      chunks.length = 0;
      changed();
    }
  });
  server.requestTimeout = 5000;
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Receiver unavailable");
  return {
    endpoint: `http://127.0.0.1:${address.port}/v1/metrics`,
    snapshot: () => ({
      schemaVersion: "renma.plugin-usage-observations.v1",
      startedAt,
      timeBasis: "collector-receipt-utc",
      producerScope: "one-owned-codex-process",
      requests: Math.min(requests, 513),
      rejectedRequests,
      unknownSkillObserved,
      samples: samples.map((s) => ({
        ...s,
        dimensions: { ...s.dimensions },
        unsupportedDimensionKinds: [...s.unsupportedDimensionKinds],
      })),
      skills: summarize(samples),
    }),
    close: async () => {
      const timer = setTimeout(() => server.closeAllConnections(), 1000);
      await new Promise<void>((resolve) => server.close(() => resolve()));
      clearTimeout(timer);
    },
  };
}
