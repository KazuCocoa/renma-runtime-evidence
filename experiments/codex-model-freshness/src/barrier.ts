import { createHash } from "node:crypto";
import {
  LISTING_DESCRIPTIONS,
  LISTING_FIXTURE_NAME,
} from "../../codex-listing-freshness/src/listing.js";
import { ARTIFACT, TOKENS, object, type Revision } from "./contract.js";

export const BARRIER_TOOL = "renma_freshness_barrier";
export const BARRIER_SPEC = {
  type: "function",
  name: BARRIER_TOOL,
  description:
    "Complete the synthetic runtime-evidence barrier once. Takes no arguments.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
} as const;

export function barrierFixture(revision: Revision): string {
  return `---\nname: ${LISTING_FIXTURE_NAME}\ndescription: ${LISTING_DESCRIPTIONS[revision]}\n---\n\nThis is a synthetic runtime-evidence fixture. First call ${BARRIER_TOOL} exactly once with an empty object. After it returns, write exactly ${TOKENS[revision]} with no newline into ${ARTIFACT} in the current workspace. Do not read other files, use other Skills, or spawn agents. Return a short acknowledgement.\n`;
}

export function barrierDeployment(revision: Revision) {
  return Object.freeze({
    provenance: "experiment-wrapper" as const,
    revision,
    scope: "exact-known-barrier-fixture-bytes" as const,
    digest: `sha256:${createHash("sha256").update(barrierFixture(revision)).digest("hex")}`,
  });
}

export interface BarrierRouting {
  readonly requestId: string | number;
  readonly threadId: string;
  readonly turnId: string;
  readonly callId: string;
}
const routingId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 256;

/** Retain routing handles only in memory; discard tool arguments immediately. */
export function reduceBarrierRequest(
  value: unknown,
  expectedThread: string,
): BarrierRouting {
  const message = object(value);
  const params = object(message?.params);
  const args = object(params?.arguments);
  if (
    message?.method !== "item/tool/call" ||
    !(
      routingId(message.id) ||
      (typeof message.id === "number" && Number.isSafeInteger(message.id))
    ) ||
    params?.threadId !== expectedThread ||
    !routingId(params.turnId) ||
    !routingId(params.callId) ||
    params.tool !== BARRIER_TOOL ||
    params.namespace !== null ||
    !args ||
    Object.keys(args).length !== 0
  )
    throw new Error("Unsupported barrier request");
  return {
    requestId: message.id,
    threadId: expectedThread,
    turnId: params.turnId,
    callId: params.callId,
  };
}

export function reduceBarrierCompletion(
  value: unknown,
  routing: BarrierRouting,
): "success" | "failure" | "unsupported" | undefined {
  const message = object(value);
  const params = object(message?.params);
  const item = object(params?.item);
  if (
    message?.method !== "item/completed" ||
    params?.threadId !== routing.threadId ||
    params.turnId !== routing.turnId ||
    item?.id !== routing.callId ||
    item.type !== "dynamicToolCall" ||
    item.tool !== BARRIER_TOOL ||
    item.namespace !== null
  )
    return undefined;
  if (item.status === "completed" && item.success === true) return "success";
  if (item.status === "failed" || item.success === false) return "failure";
  return "unsupported";
}
