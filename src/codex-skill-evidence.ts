import { createServer, type Server } from "node:http";

const TARGET_METRIC_NAME = "codex.skill.injected";
const INVALID_ALLOWLIST_MESSAGE = "Invalid Codex Skill evidence allowlist";
const MALFORMED_PAYLOAD_MESSAGE = "Malformed OTLP metrics request";

const MAX_ALLOWED_SKILLS = 128;
const MAX_SKILL_NAME_CODE_POINTS = 256;
const MAX_SKILL_NAME_UTF8_BYTES = 1024;
const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const SHUTDOWN_GRACE_PERIOD_MS = 5_000;

const unsupportedControlCharacters = /[\u0000-\u001f\u007f-\u009f]/u;

export interface CodexSkillEvidenceCollectorOptions {
  readonly allowedSkills: readonly string[];
}

export interface CodexSkillPresenceSnapshot {
  readonly schemaVersion: 1;
  readonly provider: "codex";
  readonly signal: "skill-injected";
  readonly observationScope: "collector-lifetime";
  readonly injectedSkills: readonly string[];
  readonly unrecognizedSkillObserved: boolean;
}

export interface CodexSkillEvidenceCollector {
  readonly endpoint: string;
  closeAndSnapshot(): Promise<CodexSkillPresenceSnapshot>;
}

type UnknownRecord = Record<string, unknown>;

interface ParsedRequestObservation {
  injectedSkills: Set<string>;
  unrecognizedSkillObserved: boolean;
}

function malformedPayload(): Error {
  return new Error(MALFORMED_PAYLOAD_MESSAGE);
}

function asRecord(value: unknown): UnknownRecord | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as UnknownRecord;
}

function requireRecord(value: unknown): UnknownRecord {
  const record = asRecord(value);
  if (!record) {
    throw malformedPayload();
  }
  return record;
}

function requireArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw malformedPayload();
  }
  return value;
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      if (index + 1 >= value.length) {
        return false;
      }
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (nextCodeUnit < 0xdc00 || nextCodeUnit > 0xdfff) {
        return false;
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function validateAllowedSkillsUnchecked(options: unknown): Set<string> {
  const optionsRecord = asRecord(options);
  const candidateSkills = optionsRecord?.allowedSkills;
  if (
    !Array.isArray(candidateSkills) ||
    candidateSkills.length === 0 ||
    candidateSkills.length > MAX_ALLOWED_SKILLS
  ) {
    throw new TypeError(INVALID_ALLOWLIST_MESSAGE);
  }

  const allowedSkills = new Set<string>();
  for (const candidate of candidateSkills) {
    if (
      typeof candidate !== "string" ||
      candidate.length === 0 ||
      !isWellFormedUnicode(candidate) ||
      [...candidate].length > MAX_SKILL_NAME_CODE_POINTS ||
      Buffer.byteLength(candidate, "utf8") > MAX_SKILL_NAME_UTF8_BYTES ||
      unsupportedControlCharacters.test(candidate)
    ) {
      throw new TypeError(INVALID_ALLOWLIST_MESSAGE);
    }
    allowedSkills.add(candidate);
  }
  return allowedSkills;
}

function validateAllowedSkills(options: unknown): Set<string> {
  try {
    return validateAllowedSkillsUnchecked(options);
  } catch {
    throw new TypeError(INVALID_ALLOWLIST_MESSAGE);
  }
}

function readRequiredStringAttribute(
  attributes: unknown[],
  requiredKey: "skill" | "status",
): string {
  const matchingAttributes: UnknownRecord[] = [];
  for (const candidate of attributes) {
    const attribute = requireRecord(candidate);
    if (attribute.key === requiredKey) {
      matchingAttributes.push(attribute);
    }
  }
  if (matchingAttributes.length !== 1) {
    throw malformedPayload();
  }

  const attribute = matchingAttributes[0];
  if (!attribute) {
    throw malformedPayload();
  }
  const value = requireRecord(attribute.value);
  if (typeof value.stringValue !== "string") {
    throw malformedPayload();
  }
  return value.stringValue;
}

function parseRequestObservation(
  payload: unknown,
  allowedSkills: ReadonlySet<string>,
): ParsedRequestObservation {
  const root = requireRecord(payload);
  const injectedSkills = new Set<string>();
  let unrecognizedSkillObserved = false;

  for (const resourceCandidate of requireArray(root.resourceMetrics)) {
    const resourceMetric = requireRecord(resourceCandidate);
    for (const scopeCandidate of requireArray(resourceMetric.scopeMetrics)) {
      const scopeMetric = requireRecord(scopeCandidate);
      for (const metricCandidate of requireArray(scopeMetric.metrics)) {
        const metric = requireRecord(metricCandidate);
        if (typeof metric.name !== "string") {
          throw malformedPayload();
        }
        if (metric.name !== TARGET_METRIC_NAME) {
          continue;
        }

        const sum = requireRecord(metric.sum);
        const dataPoints =
          sum.dataPoints === undefined ? [] : requireArray(sum.dataPoints);
        for (const pointCandidate of dataPoints) {
          const point = requireRecord(pointCandidate);
          const attributes = requireArray(point.attributes);
          const skill = readRequiredStringAttribute(attributes, "skill");
          const status = readRequiredStringAttribute(attributes, "status");
          if (status !== "ok") {
            continue;
          }
          if (allowedSkills.has(skill)) {
            injectedSkills.add(skill);
          } else {
            unrecognizedSkillObserved = true;
          }
        }
      }
    }
  }

  return { injectedSkills, unrecognizedSkillObserved };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(new Error("Codex Skill evidence collector failed to close"));
      } else {
        resolve();
      }
    });
  });
}

async function listenOnLoopback(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const handleError = () => {
      reject(new Error("Codex Skill evidence collector failed to start"));
    };
    server.once("error", handleError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", handleError);
      resolve();
    });
  });
}

function waitForGracePeriod(): {
  promise: Promise<void>;
  cancel(): void;
} {
  let timeout: NodeJS.Timeout | undefined;
  const promise = new Promise<void>((resolve) => {
    timeout = setTimeout(resolve, SHUTDOWN_GRACE_PERIOD_MS);
    timeout.unref();
  });
  return {
    promise,
    cancel: () => {
      if (timeout) {
        clearTimeout(timeout);
      }
    },
  };
}

export async function createCodexSkillEvidenceCollector(
  options: CodexSkillEvidenceCollectorOptions,
): Promise<CodexSkillEvidenceCollector> {
  const allowedSkills = validateAllowedSkills(options);
  const injectedSkills = new Set<string>();
  let unrecognizedSkillObserved = false;
  const inFlightRequests = new Set<Promise<void>>();

  function trackRequest(): () => void {
    let resolveRequest: (() => void) | undefined;
    const requestCompleted = new Promise<void>((resolve) => {
      resolveRequest = resolve;
    });
    inFlightRequests.add(requestCompleted);

    let completed = false;
    return () => {
      if (completed) {
        return;
      }
      completed = true;
      inFlightRequests.delete(requestCompleted);
      resolveRequest?.();
    };
  }

  async function waitForAcceptedRequests(): Promise<void> {
    while (inFlightRequests.size > 0) {
      await Promise.all(inFlightRequests);
    }
  }

  const server = createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/metrics") {
      response.writeHead(404).end();
      return;
    }

    const completeRequest = trackRequest();
    const chunks: Buffer[] = [];
    let receivedBytes = 0;
    let requestTooLarge = false;
    let requestDiscarded = false;

    const discardAbortedRequest = () => {
      requestDiscarded = true;
      chunks.length = 0;
      completeRequest();
    };
    request.once("aborted", discardAbortedRequest);
    request.once("error", discardAbortedRequest);
    response.once("close", discardAbortedRequest);

    request.on("data", (chunk: Buffer) => {
      receivedBytes += chunk.length;
      if (requestTooLarge || receivedBytes > MAX_REQUEST_BYTES) {
        requestTooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });

    request.on("end", () => {
      try {
        if (requestDiscarded) {
          return;
        }
        if (requestTooLarge) {
          response.writeHead(413).end();
          return;
        }

        const payload: unknown = JSON.parse(
          Buffer.concat(chunks).toString("utf8"),
        );
        const requestObservation = parseRequestObservation(
          payload,
          allowedSkills,
        );
        for (const skill of requestObservation.injectedSkills) {
          injectedSkills.add(skill);
        }
        unrecognizedSkillObserved ||=
          requestObservation.unrecognizedSkillObserved;
        response.writeHead(200, { "content-type": "application/json" });
        response.end("{}\n");
      } catch {
        response.writeHead(400).end();
      } finally {
        chunks.length = 0;
        completeRequest();
      }
    });
  });

  await listenOnLoopback(server);
  const address = server.address();
  if (address === null || typeof address === "string") {
    await closeServer(server);
    throw new Error("Codex Skill evidence collector failed to start");
  }

  let shutdownPromise: Promise<void> | undefined;

  async function drainAndClose(): Promise<void> {
    const serverClosed = closeServer(server);
    const drained = (async () => {
      await waitForAcceptedRequests();
      await serverClosed;
      await waitForAcceptedRequests();
    })();
    const gracePeriod = waitForGracePeriod();
    try {
      const completedWithinGracePeriod = await Promise.race([
        drained.then(() => true),
        gracePeriod.promise.then(() => false),
      ]);
      if (!completedWithinGracePeriod) {
        server.closeAllConnections();
        await drained;
      }
    } finally {
      gracePeriod.cancel();
    }
  }

  function createDefensiveSnapshot(): CodexSkillPresenceSnapshot {
    const sortedSkills = Object.freeze([...injectedSkills].sort());
    return Object.freeze({
      schemaVersion: 1 as const,
      provider: "codex" as const,
      signal: "skill-injected" as const,
      observationScope: "collector-lifetime" as const,
      injectedSkills: sortedSkills,
      unrecognizedSkillObserved,
    });
  }

  return {
    endpoint: `http://127.0.0.1:${address.port}/v1/metrics`,
    closeAndSnapshot: async () => {
      shutdownPromise ??= drainAndClose();
      await shutdownPromise;
      return createDefensiveSnapshot();
    },
  };
}
