import { once } from "node:events";
import { createServer } from "node:http";
import type { bindRuntimeOtelProjection } from "./runtime-otel.js";

type Packet = ReturnType<
  ReturnType<typeof bindRuntimeOtelProjection>["project"]
>;

/** Send only the already-reduced projection to an owned, bounded byte comparator. */
export async function exportToFixtureReceiver(packet: Packet) {
  const expected = Buffer.from(JSON.stringify(packet));
  if (expected.length > 32 * 1024)
    throw new Error("Projection exceeds fixture bound");
  let received = false;
  const server = createServer((request, response) => {
    if (
      received ||
      request.method !== "POST" ||
      request.url !== "/v1/logs" ||
      request.headers["content-type"] !== "application/json"
    ) {
      response.writeHead(400).end();
      request.resume();
      return;
    }
    let offset = 0;
    let matched = true;
    request.on("data", (chunk: Buffer) => {
      if (offset + chunk.length > expected.length) {
        matched = false;
        request.destroy();
        return;
      }
      if (!chunk.equals(expected.subarray(offset, offset + chunk.length)))
        matched = false;
      offset += chunk.length;
    });
    request.on("error", () => {
      matched = false;
    });
    request.on("end", () => {
      received = matched && offset === expected.length;
      response
        .writeHead(received ? 200 : 400, { "content-type": "application/json" })
        .end("{}");
    });
  });
  server.requestTimeout = 5_000;
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Fixture receiver unavailable");
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/logs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: expected,
      signal: AbortSignal.timeout(5_000),
    });
    await response.body?.cancel();
    if (response.status !== 200 || !received)
      throw new Error("Fixture OTLP transfer failed");
    return Object.freeze({
      transport: "otlp-http-json" as const,
      receiver: "owned-loopback-byte-comparator" as const,
      exactReducedPacketReceived: true,
      backendInteroperabilityClaimed: false,
    });
  } finally {
    server.closeAllConnections();
    if (server.listening)
      await new Promise<void>((done, reject) =>
        server.close((error) =>
          error ? reject(new Error("Fixture receiver cleanup failed")) : done(),
        ),
      );
  }
}
