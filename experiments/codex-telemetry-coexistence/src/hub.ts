import { createServer } from "node:http";
import { once } from "node:events";
import {
  reduceMetrics,
  summarize,
  type Sample,
} from "../../codex-plugin-usage/src/collector.js";

export const PRODUCERS = ["first", "second", "restarted"] as const;
export const CONSUMERS = ["alpha", "beta"] as const;
export type Producer = (typeof PRODUCERS)[number];
export type Consumer = (typeof CONSUMERS)[number];

/** Owned loopback fixture only. Route identity is wrapper provenance, not a provider field. */
export async function createHub(firstConsumer: Consumer, port = 0) {
  const started = performance.now();
  const samples: Record<Producer, Sample[]> = {
    first: [],
    second: [],
    restarted: [],
  };
  const failedExports: {
    producer: Producer;
    samples: Sample[];
    observedAt: string;
  }[] = [];
  const availability: { accepting: boolean; observedAt: string }[] = [];
  let accepting = true;
  const acknowledged = Object.fromEntries(
    PRODUCERS.map((p) => [p, { alpha: 0, beta: 0 }]),
  ) as Record<Producer, Record<Consumer, number>>;
  const events: {
    producer: Producer;
    consumer: Consumer;
    action: "start" | "stop";
    observedAt: string;
  }[] = [];
  let requests = 0,
    rejected = 0,
    unknownSkillObserved = false;
  const project = (p: Producer, c: Consumer) =>
    samples[p].filter((s) => s.skill === `renma-usage-${c}`);
  const server = createServer(async (req, res) => {
    const send = (status: number, body: unknown = {}) =>
      res
        .writeHead(status, { "content-type": "application/json" })
        .end(JSON.stringify(body));
    const parts = (req.url ?? "").split("/");
    const p = parts[2] as Producer,
      c = parts[3] as Consumer;
    const at = new Date().toISOString(),
      elapsed = Math.round(performance.now() - started);
    try {
      if (++requests > 4096) throw new Error("Limit");
      if (req.method === "GET" && req.url === "/health") {
        send(200, { service: "renma-coexistence-fixture" });
        return;
      }
      if (!PRODUCERS.includes(p)) {
        send(404);
        req.resume();
        return;
      }
      if (
        req.method === "POST" &&
        parts[1] === "metrics" &&
        parts.length === 3
      ) {
        const chunks: Buffer[] = [];
        let size = 0;
        try {
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 2 * 1024 * 1024) throw new Error("Limit");
            chunks.push(chunk);
          }
          const reduced = reduceMetrics(
            JSON.parse(Buffer.concat(chunks).toString("utf8")),
            at,
            elapsed,
          );
          if (!accepting) {
            if (failedExports.length >= 128) throw new Error("Limit");
            failedExports.push({
              producer: p,
              samples: reduced.samples,
              observedAt: at,
            });
            send(503);
            return;
          }
          if (samples[p].length + reduced.samples.length > 256)
            throw new Error("Limit");
          samples[p].push(...reduced.samples);
          unknownSkillObserved ||= reduced.unknownSkillObserved;
        } finally {
          chunks.length = 0;
        }
        send(200);
        return;
      }
      req.resume();
      if (!CONSUMERS.includes(c)) {
        send(404);
        return;
      }
      if (req.method === "GET" && parts[1] === "view" && parts.length === 4) {
        send(200, { sampleCount: project(p, c).length });
        return;
      }
      if (
        req.method === "POST" &&
        parts[1] === "ack" &&
        parts.length === 5 &&
        /^[0-9]{1,3}$/.test(parts[4]!)
      ) {
        const n = Number(parts[4]);
        if (n > project(p, c).length)
          throw new Error("Invalid acknowledgement");
        acknowledged[p][c] = Math.max(acknowledged[p][c], n);
        send(200);
        return;
      }
      if (
        req.method === "POST" &&
        (parts[1] === "start" || parts[1] === "stop") &&
        parts.length === 4
      ) {
        if (
          parts[1] === "start" &&
          c !== firstConsumer &&
          !events.some(
            (e) =>
              e.producer === p &&
              e.consumer === firstConsumer &&
              e.action === "start",
          )
        ) {
          send(425);
          return;
        }
        if (events.length >= 128) throw new Error("Limit");
        events.push({
          producer: p,
          consumer: c,
          action: parts[1],
          observedAt: at,
        });
        send(200);
        return;
      }
      send(404);
    } catch {
      rejected++;
      send(400);
    }
  });
  server.requestTimeout = 5000;
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Listener unavailable");
  return {
    base: `http://127.0.0.1:${address.port}`,
    setAccepting: (value: boolean) => {
      if (availability.length >= 16) throw new Error("Transition limit");
      accepting = value;
      availability.push({ accepting, observedAt: new Date().toISOString() });
    },
    snapshot: () =>
      structuredClone({
        evidenceClass: "wrapper-reduced-actual-http",
        identityBasis: "dedicated-wrapper-ingress-route",
        requests,
        rejected,
        unknownSkillObserved,
        events,
        availability,
        failedExports,
        producers: PRODUCERS.map((producer) => ({
          producer,
          samples: samples[producer],
          skills: summarize(samples[producer]),
          acknowledged: acknowledged[producer],
        })),
      }),
    close: async () => {
      const timer = setTimeout(() => server.closeAllConnections(), 1000);
      await new Promise<void>((resolve) => server.close(() => resolve()));
      clearTimeout(timer);
    },
  };
}
