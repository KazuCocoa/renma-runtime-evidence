import { setTimeout as delay } from "node:timers/promises";
// Installed as two distinct synthetic plugins. No listener, tools, or persistent payloads.
const [base, role, revision] = process.argv.slice(2);
if (
  !base ||
  !/^http:\/\/127\.0\.0\.1:[0-9]{1,5}$/.test(base) ||
  !["primary", "companion"].includes(role ?? "") ||
  !["initial", "updated"].includes(revision ?? "")
)
  process.exit(1);
const call = (path: string) =>
  fetch(`${base}/${path}`, {
    method: "POST",
    signal: AbortSignal.timeout(2000),
  });
let instance: number;
try {
  const response = await call(`start/${role}/${revision}`);
  let body = "";
  if (!response.body) throw new Error("Missing response");
  for await (const chunk of response.body) {
    if (body.length + chunk.length > 3) throw new Error("Limit");
    body += Buffer.from(chunk).toString("utf8");
  }
  instance = Number(body);
  if (
    response.status !== 200 ||
    !Number.isInteger(instance) ||
    instance < 1 ||
    instance > 128
  )
    throw new Error("Invalid instance");
} catch {
  process.exit(1);
}
let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  try {
    const response = await call(`stop/${instance}`);
    await response.body?.cancel();
  } catch {
    /* No inferred stop on failure. */
  }
  process.exit(0);
};
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
process.stdin.on("end", () => void stop());
process.stdout.on("error", () => void stop());
setTimeout(() => void stop(), 120000).unref();
let buffer = "";
process.stdin.on("data", (chunk: Buffer) => {
  if (Buffer.byteLength(buffer) + chunk.length > 65536) {
    void stop();
    return;
  }
  buffer += chunk.toString("utf8");
  let end: number;
  while ((end = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    try {
      const m = JSON.parse(line);
      if (m.id === undefined) continue;
      if (!(
        Number.isSafeInteger(m.id) ||
        (typeof m.id === "string" && m.id.length <= 128)
      ))
        throw new Error("Routing");
      const result =
        m.method === "initialize"
          ? {
              protocolVersion: "2024-11-05",
              capabilities: { tools: {} },
              serverInfo: {
                name: `renma-lifecycle-${role}`,
                version: "1.0.0",
              },
            }
          : m.method === "tools/list"
            ? { tools: [] }
            : m.method === "ping"
              ? {}
              : null;
      process.stdout.write(
        JSON.stringify(
          result === null
            ? {
                jsonrpc: "2.0",
                id: m.id,
                error: { code: -32601, message: "Unsupported method" },
              }
            : { jsonrpc: "2.0", id: m.id, result },
        ) + "\n",
      );
    } catch {
      void stop();
    }
  }
});
while (!stopping) {
  try {
    const response = await call(`beat/${instance}`);
    await response.body?.cancel();
  } catch {
    /* Missing heartbeat is unknown, not proof of termination. */
  }
  await delay(250);
}
