import { createServer } from "node:http";
import { performance } from "node:perf_hooks";

// Owned fixture control plane. Instance numbers are issued here, never OS or user IDs.
export async function createProbe() {
  const instances: {
    instance: number;
    role: "primary" | "companion";
    revision: "initial" | "updated";
    startedAt: string;
    lastHeartbeatAt: string | null;
    stoppedAt: string | null;
    lastBeat: number | null;
  }[] = [];
  let requests = 0;
  const server = createServer((req, res) => {
    req.resume();
    if (++requests > 10000 || req.method !== "POST") {
      res.writeHead(400).end();
      return;
    }
    const start = /^\/start\/(primary|companion)\/(initial|updated)$/.exec(
      req.url ?? "",
    );
    const event = /^\/(beat|stop)\/([1-9][0-9]{0,2})$/.exec(req.url ?? "");
    const now = new Date().toISOString();
    if (start && instances.length < 128) {
      const instance = instances.length + 1;
      instances.push({
        instance,
        role: start[1] as "primary" | "companion",
        revision: start[2] as "initial" | "updated",
        startedAt: now,
        lastHeartbeatAt: null,
        stoppedAt: null,
        lastBeat: null,
      });
      res.end(String(instance));
    } else if (event && instances[Number(event[2]) - 1]) {
      const row = instances[Number(event[2]) - 1]!;
      if (event[1] === "stop") row.stoppedAt = now;
      else if (!row.stoppedAt) {
        row.lastHeartbeatAt = now;
        row.lastBeat = performance.now();
      }
      res.end();
    } else res.writeHead(400).end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Probe unavailable");
  return {
    base: `http://127.0.0.1:${address.port}`,
    snapshot: () => ({
      observedAt: new Date().toISOString(),
      instances: instances.map(({ lastBeat, ...row }) => ({
        ...row,
        recentHeartbeat:
          lastBeat !== null &&
          performance.now() - lastBeat < 1500 &&
          row.stoppedAt === null,
      })),
    }),
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
