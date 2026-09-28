import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { createHub } from "../src/hub.js";

test(
  "two observers register in either controlled order, acknowledge views, and exit without stopping the hub",
  { timeout: 15000 },
  async () => {
    for (const first of ["alpha", "beta"] as const) {
      const hub = await createHub(first);
      const children: ReturnType<typeof spawn>[] = [];
      const closed: Promise<unknown>[] = [];
      try {
        const initialized = [];
        for (const role of ["beta", "alpha"] as const) {
          const child = spawn(
            process.execPath,
            [
              fileURLToPath(new URL("../src/observer.js", import.meta.url)),
              hub.base,
              "first",
              role,
            ],
            { stdio: ["pipe", "pipe", "ignore"] },
          );
          children.push(child);
          closed.push(once(child, "close"));
          const response = once(child.stdout!, "data");
          child.stdin!.write(
            JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }) +
              "\n",
          );
          initialized.push(
            response.then(([chunk]) =>
              assert.equal(
                JSON.parse(String(chunk)).result.serverInfo.name,
                `renma-observer-${role}`,
              ),
            ),
          );
        }
        await Promise.all(initialized);
        assert.equal(hub.snapshot().events[0]!.consumer, first);
        for (const child of children) child.kill("SIGTERM");
        await Promise.all(closed);
        assert.equal(
          hub.snapshot().events.filter((e) => e.action === "stop").length,
          2,
        );
        const response = await fetch(hub.base + "/health");
        assert.equal(response.status, 200);
        await response.body?.cancel();
      } finally {
        for (const child of children) child.kill("SIGKILL");
        await Promise.all(closed);
        await hub.close();
      }
    }
  },
);
