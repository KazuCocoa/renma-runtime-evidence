import assert from "node:assert/strict";
import test from "node:test";
import {
  BARRIER_TOOL,
  barrierDeployment,
  barrierFixture,
  reduceBarrierCompletion,
  reduceBarrierRequest,
} from "../src/barrier.js";

const request = {
  id: 77,
  method: "item/tool/call",
  params: {
    threadId: "thread",
    turnId: "turn",
    callId: "call",
    namespace: null,
    tool: BARRIER_TOOL,
    arguments: {},
  },
};

test("barrier accepts only exact tool, thread, empty arguments, and bounded routing IDs", () => {
  const result = reduceBarrierRequest(
    { ...request, discarded: "PRIVATE" },
    "thread",
  );
  assert.deepEqual(result, {
    requestId: 77,
    threadId: "thread",
    turnId: "turn",
    callId: "call",
  });
  for (const params of [
    { ...request.params, threadId: "other" },
    { ...request.params, tool: "PRIVATE_TOOL" },
    { ...request.params, namespace: "unexpected" },
    { ...request.params, arguments: { private: "PRIVATE_INPUT" } },
    { ...request.params, arguments: [] },
    { ...request.params, callId: "x".repeat(257) },
  ])
    assert.throws(() => reduceBarrierRequest({ ...request, params }, "thread"));
  assert.throws(() => reduceBarrierRequest({ ...request, id: {} }, "thread"));
  assert.throws(() =>
    reduceBarrierRequest(
      { ...request, method: "item/permissions/requestApproval" },
      "thread",
    ),
  );
});

test("tool terminal status is reduced only for the exact correlated capability call", () => {
  const routing = reduceBarrierRequest(request, "thread");
  const message = {
    method: "item/completed",
    params: {
      threadId: "thread",
      turnId: "turn",
      item: {
        id: "call",
        type: "dynamicToolCall",
        namespace: null,
        tool: BARRIER_TOOL,
        status: "completed",
        success: true,
        arguments: { private: "PRIVATE_INPUT" },
        contentItems: ["PRIVATE_OUTPUT"],
      },
    },
  };
  assert.equal(reduceBarrierCompletion(message, routing), "success");
  assert.equal(
    reduceBarrierCompletion(
      { ...message, params: { ...message.params, turnId: "other" } },
      routing,
    ),
    undefined,
  );
  assert.equal(
    reduceBarrierCompletion(
      {
        ...message,
        params: {
          ...message.params,
          item: { ...message.params.item, tool: "other" },
        },
      },
      routing,
    ),
    undefined,
  );
  assert.equal(
    reduceBarrierCompletion(
      {
        ...message,
        params: {
          ...message.params,
          item: { ...message.params.item, success: false },
        },
      },
      routing,
    ),
    "failure",
  );
  assert.equal(
    reduceBarrierCompletion(
      {
        ...message,
        params: {
          ...message.params,
          item: {
            ...message.params.item,
            status: "PRIVATE_STATUS",
            success: null,
          },
        },
      },
      routing,
    ),
    "unsupported",
  );
});

test("barrier A/B manifests remain wrapper snapshots with different exact fixture digests", () => {
  const a = barrierDeployment("a");
  const b = barrierDeployment("b");
  assert.notEqual(a.digest, b.digest);
  assert.equal(a.revision, "a");
  assert.equal(Object.isFrozen(a), true);
  assert.equal(a.provenance, "experiment-wrapper");
  assert.match(barrierFixture("a"), /First call renma_freshness_barrier/);
  assert.ok(!barrierFixture("a").includes("RENMA_MODEL_FRESHNESS_B"));
});
