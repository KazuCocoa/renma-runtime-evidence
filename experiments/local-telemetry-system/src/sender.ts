import { observation, observationId, encodeOtlp } from "./record.js";
import { readRecords, writeRecords } from "./storage.js";
export function durableSender(
  path: string,
  endpoint: string,
  initialToken: string,
) {
  const url = new URL(endpoint);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.pathname !== "/v1/logs" ||
    url.username ||
    url.password ||
    url.search
  )
    throw new Error("Local endpoint required");
  let queue = readRecords(path);
  let token = initialToken,
    attempts = 0,
    nextAttemptAt = 0,
    active = false;
  let state:
    | "ready"
    | "retry"
    | "blocked-auth"
    | "blocked-payload"
    | "blocked-partial"
    | "exhausted" = "ready";
  return {
    enqueue(input: unknown) {
      const record = observation(input);
      if (queue.some((row) => observationId(row) === observationId(record)))
        return;
      if (queue.length >= 256) throw new Error("Queue full");
      const next = [...queue, record];
      writeRecords(path, next);
      queue = next;
    },
    setToken(value: string) {
      token = value;
      state = "ready";
      attempts = 0;
      nextAttemptAt = 0;
    },
    snapshot: () => ({ pending: queue.length, attempts, state }),
    async flush() {
      if (
        active ||
        !queue.length ||
        !["ready", "retry"].includes(state) ||
        Date.now() < nextAttemptAt
      )
        return;
      active = true;
      const batch = queue.slice(0, 16);
      attempts++;
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          redirect: "manual",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(encodeOtlp(batch)),
          signal: AbortSignal.timeout(1000),
        });
        if (response.status === 401 || response.status === 403) {
          await response.body?.cancel();
          state = "blocked-auth";
          return;
        }
        if ([429, 502, 503, 504].includes(response.status)) {
          await response.body?.cancel();
          throw new Error("Retryable");
        }
        if (response.status !== 200) {
          await response.body?.cancel();
          state = "blocked-payload";
          return;
        }
        let body = "";
        if (response.body)
          for await (const chunk of response.body) {
            if (body.length + chunk.length > 4096) {
              state = "blocked-payload";
              return;
            }
            body += Buffer.from(chunk).toString("utf8");
          }
        let parsed: unknown;
        try {
          parsed = JSON.parse(body);
        } catch {
          state = "blocked-payload";
          return;
        }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          state = "blocked-payload";
          return;
        }
        const partial = (
          parsed as {
            partialSuccess?: {
              rejectedLogRecords?: unknown;
              errorMessage?: unknown;
            };
          }
        ).partialSuccess;
        if (
          partial !== undefined &&
          (!partial ||
            typeof partial !== "object" ||
            Array.isArray(partial) ||
            (partial.rejectedLogRecords !== undefined &&
              !(
                typeof partial.rejectedLogRecords === "string" &&
                /^[0-9]+$/.test(partial.rejectedLogRecords)
              ) &&
              !(
                typeof partial.rejectedLogRecords === "number" &&
                Number.isSafeInteger(partial.rejectedLogRecords) &&
                partial.rejectedLogRecords >= 0
              )) ||
            (partial.errorMessage !== undefined &&
              typeof partial.errorMessage !== "string"))
        ) {
          state = "blocked-payload";
          return;
        }
        if (
          partial &&
          (Number(partial.rejectedLogRecords ?? 0) !== 0 ||
            partial.errorMessage)
        ) {
          state = "blocked-partial";
          return;
        }
        const ids = new Set(batch.map(observationId));
        const remaining = queue.filter((row) => !ids.has(observationId(row)));
        writeRecords(path, remaining);
        queue = remaining;
        attempts = 0;
        state = "ready";
        nextAttemptAt = 0;
      } catch {
        state = attempts >= 8 ? "exhausted" : "retry";
        nextAttemptAt = Date.now() + Math.min(2000, 100 * 2 ** (attempts - 1));
      } finally {
        active = false;
      }
    },
  };
}
