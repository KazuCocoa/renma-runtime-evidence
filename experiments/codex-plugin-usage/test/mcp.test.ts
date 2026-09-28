import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

test("bundled MCP starts collector, exposes no tools and persists only reduced observations", async () => {
  const root = await mkdtemp(join(tmpdir(), "renma-mcp-test-"));
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const address = reservation.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(new URL("../src/mcp.js", import.meta.url)),
      String(address.port),
      root,
    ],
    { stdio: ["pipe", "pipe", "ignore"] },
  );
  const closed = once(child, "close");
  try {
    const received = once(child.stdout, "data");
    child.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2024-11-05" },
      }) + "\n",
    );
    const [chunk] = await received;
    assert.equal(
      JSON.parse(String(chunk)).result.serverInfo.name,
      "renma-usage-fixture",
    );
    const body = {
      resourceMetrics: [
        {
          scopeMetrics: [
            {
              metrics: [
                {
                  name: "codex.skill.injected",
                  sum: {
                    aggregationTemporality: 2,
                    isMonotonic: true,
                    dataPoints: [
                      {
                        asInt: 1,
                        startTimeUnixNano: "1",
                        timeUnixNano: "2",
                        attributes: [
                          {
                            key: "skill",
                            value: { stringValue: "renma-usage-alpha" },
                          },
                          { key: "status", value: { stringValue: "ok" } },
                          {
                            key: "private",
                            value: { stringValue: "NEVER_PERSIST" },
                          },
                        ],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    };
    const response = await fetch(
      `http://127.0.0.1:${address.port}/v1/metrics`,
      { method: "POST", body: JSON.stringify(body) },
    );
    await response.body?.cancel();
    assert.equal(response.status, 200);
    let text = "";
    for (let i = 0; i < 50; i++) {
      text = await readFile(join(root, "observations.json"), "utf8");
      if (JSON.parse(text).samples.length) break;
      await delay(10);
    }
    assert.equal(JSON.parse(text).samples.length, 1);
    assert.equal(text.includes("NEVER_PERSIST"), false);
    assert.equal(JSON.parse(text).skills[0].providerCounterTotal, null);
  } finally {
    child.kill("SIGTERM");
    await closed;
    await rm(root, { recursive: true, force: true });
  }
});

test("a second receiver cannot claim the first receiver's port and records only a finite failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "renma-mcp-conflict-test-"));
  const occupied = createServer();
  occupied.listen(0, "127.0.0.1");
  await once(occupied, "listening");
  const address = occupied.address();
  assert.ok(address && typeof address !== "string");
  try {
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(new URL("../src/mcp.js", import.meta.url)),
        String(address.port),
        root,
      ],
      { stdio: ["ignore", "ignore", "ignore"] },
    );
    const [code] = await once(child, "close");
    assert.equal(code, 1);
    assert.deepEqual(
      JSON.parse(await readFile(join(root, "startup-failure.json"), "utf8")),
      { reason: "address-in-use" },
    );
  } finally {
    await new Promise<void>((resolve) => occupied.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test("two shared MCP clients attach without binding or owning collector lifetime", async () => {
  const { createUsageCollector } = await import("../src/collector.js");
  const collector = await createUsageCollector(0, undefined, true);
  const root = await mkdtemp(join(tmpdir(), "renma-mcp-shared-"));
  const children: ReturnType<typeof spawn>[] = [];
  const closed: Promise<unknown>[] = [];
  try {
    for (let index = 0; index < 2; index++) {
      const child = spawn(
        process.execPath,
        [
          fileURLToPath(new URL("../src/mcp.js", import.meta.url)),
          new URL(collector.endpoint).port,
          root,
          "--shared",
        ],
        { stdio: ["pipe", "pipe", "ignore"] },
      );
      children.push(child);
      closed.push(once(child, "close"));
      const received = once(child.stdout!, "data");
      child.stdin!.write(
        JSON.stringify({ jsonrpc: "2.0", id: index, method: "initialize" }) +
          "\n",
      );
      const [chunk] = await received;
      assert.equal(
        JSON.parse(String(chunk)).result.serverInfo.name,
        "renma-usage-fixture",
      );
    }
    for (let index = 0; index < children.length; index++) {
      children[index]!.stdin!.end();
      await closed[index];
      const response = await fetch(new URL("/health", collector.endpoint));
      assert.equal(response.status, 200);
      await response.body?.cancel();
    }
    const response = await fetch(collector.endpoint, {
      method: "POST",
      body: JSON.stringify({ resourceMetrics: [] }),
    });
    assert.equal(response.status, 200);
    await response.body?.cancel();
    assert.equal(collector.snapshot().requests, 1);
    await assert.rejects(readFile(join(root, "observations.json")), {
      code: "ENOENT",
    });
    await assert.rejects(readFile(join(root, "startup-failure.json")), {
      code: "ENOENT",
    });
  } finally {
    for (const child of children) child.kill("SIGTERM");
    await Promise.all(closed);
    await collector.close();
    await rm(root, { recursive: true, force: true });
  }
});
