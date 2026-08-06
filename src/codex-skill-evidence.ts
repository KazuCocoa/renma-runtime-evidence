import { createServer, type Server } from "node:http";

const TARGET_METRIC_NAME = "codex.skill.injected";
const INVALID_ALLOWLIST_MESSAGE = "Invalid Codex Skill evidence allowlist";
const MALFORMED_PAYLOAD_MESSAGE = "Malformed OTLP metrics request";

const MAX_ALLOWED_SKILLS = 128;
const MAX_SKILL_NAME_CODE_POINTS = 256;
const MAX_SKILL_NAME_UTF8_BYTES = 1024;
const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const SHUTDOWN_GRACE_PERIOD_MS = 5_000;
const NO_RECORDED_VALUE_FLAG = 1;
const MAX_UINT32 = 0xffff_ffff;
const MIN_INT64 = -(1n << 63n);
const MAX_INT64 = (1n << 63n) - 1n;

const unsupportedControlCharacters = /[\u0000-\u001f\u007f-\u009f]/u;
const decimalInteger = /^-?(?:0|[1-9][0-9]*)$/u;

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

export interface CodexSkillEvidenceDiagnosticsSnapshot {
  readonly schemaVersion: 1;
  readonly otlpMetricsRequestsReceived: number;
  readonly successfullyDecodedRequests: number;
  readonly decodeFailures: number;
  readonly requestReadFailures: number;
  readonly requestBodyTooLargeFailures: number;
  readonly jsonParseFailures: number;
  readonly otlpValidationFailures: number;
  readonly resourceMetricsEntriesInspected: number;
  readonly scopeMetricsEntriesInspected: number;
  readonly metricsInspected: number;
  readonly metricDataPointsInspected: number;
  readonly targetMetricsObserved: number;
  readonly targetDataPointsObserved: number;
  readonly targetDataPointsWithStatusOk: number;
  readonly targetDataPointsWithStatusError: number;
  readonly targetDataPointsWithOtherOrMissingStatus: number;
  readonly positiveTargetDataPoints: number;
  readonly zeroTargetDataPoints: number;
  readonly negativeTargetDataPoints: number;
  readonly targetDataPointsWithNoRecordedValue: number;
  readonly targetDataPointsWithUnsupportedOrMissingValue: number;
  readonly acceptedAllowlistedSkillDataPoints: number;
  readonly unknownOrMissingSkillLabelDataPoints: number;
  readonly counterSaturationObserved: boolean;
}

export interface CodexSkillEvidenceCollector {
  readonly endpoint: string;
  diagnosticsSnapshot(): CodexSkillEvidenceDiagnosticsSnapshot;
  closeAndSnapshot(): Promise<CodexSkillPresenceSnapshot>;
}

type UnknownRecord = Record<string, unknown>;

interface ParsedRequestObservation {
  injectedSkills: Set<string>;
  unrecognizedSkillObserved: boolean;
}

interface MutableDiagnostics {
  otlpMetricsRequestsReceived: number;
  successfullyDecodedRequests: number;
  decodeFailures: number;
  requestReadFailures: number;
  requestBodyTooLargeFailures: number;
  jsonParseFailures: number;
  otlpValidationFailures: number;
  resourceMetricsEntriesInspected: number;
  scopeMetricsEntriesInspected: number;
  metricsInspected: number;
  metricDataPointsInspected: number;
  targetMetricsObserved: number;
  targetDataPointsObserved: number;
  targetDataPointsWithStatusOk: number;
  targetDataPointsWithStatusError: number;
  targetDataPointsWithOtherOrMissingStatus: number;
  positiveTargetDataPoints: number;
  zeroTargetDataPoints: number;
  negativeTargetDataPoints: number;
  targetDataPointsWithNoRecordedValue: number;
  targetDataPointsWithUnsupportedOrMissingValue: number;
  acceptedAllowlistedSkillDataPoints: number;
  unknownOrMissingSkillLabelDataPoints: number;
  counterSaturationObserved: boolean;
}

type DiagnosticCounter = Exclude<
  keyof MutableDiagnostics,
  "counterSaturationObserved"
>;
type RecordedValueSign = "positive" | "zero" | "negative";
type RecordedValueObservation =
  | { readonly kind: "recorded"; readonly sign: RecordedValueSign }
  | { readonly kind: "no-recorded-value" }
  | { readonly kind: "unsupported-or-missing" };
type DecodeFailureCounter =
  | "requestReadFailures"
  | "requestBodyTooLargeFailures"
  | "jsonParseFailures"
  | "otlpValidationFailures";

function createZeroDiagnostics(): MutableDiagnostics {
  return {
    otlpMetricsRequestsReceived: 0,
    successfullyDecodedRequests: 0,
    decodeFailures: 0,
    requestReadFailures: 0,
    requestBodyTooLargeFailures: 0,
    jsonParseFailures: 0,
    otlpValidationFailures: 0,
    resourceMetricsEntriesInspected: 0,
    scopeMetricsEntriesInspected: 0,
    metricsInspected: 0,
    metricDataPointsInspected: 0,
    targetMetricsObserved: 0,
    targetDataPointsObserved: 0,
    targetDataPointsWithStatusOk: 0,
    targetDataPointsWithStatusError: 0,
    targetDataPointsWithOtherOrMissingStatus: 0,
    positiveTargetDataPoints: 0,
    zeroTargetDataPoints: 0,
    negativeTargetDataPoints: 0,
    targetDataPointsWithNoRecordedValue: 0,
    targetDataPointsWithUnsupportedOrMissingValue: 0,
    acceptedAllowlistedSkillDataPoints: 0,
    unknownOrMissingSkillLabelDataPoints: 0,
    counterSaturationObserved: false,
  };
}

function incrementDiagnostic(
  diagnostics: MutableDiagnostics,
  counter: DiagnosticCounter,
  amount = 1,
): void {
  const remaining = MAX_UINT32 - diagnostics[counter];
  if (amount > remaining) {
    diagnostics[counter] = MAX_UINT32;
    diagnostics.counterSaturationObserved = true;
  } else {
    diagnostics[counter] += amount;
  }
}

function mergeDiagnostics(
  diagnostics: MutableDiagnostics,
  requestDiagnostics: MutableDiagnostics,
): void {
  for (const counter of [
    "resourceMetricsEntriesInspected",
    "scopeMetricsEntriesInspected",
    "metricsInspected",
    "metricDataPointsInspected",
    "targetMetricsObserved",
    "targetDataPointsObserved",
    "targetDataPointsWithStatusOk",
    "targetDataPointsWithStatusError",
    "targetDataPointsWithOtherOrMissingStatus",
    "positiveTargetDataPoints",
    "zeroTargetDataPoints",
    "negativeTargetDataPoints",
    "targetDataPointsWithNoRecordedValue",
    "targetDataPointsWithUnsupportedOrMissingValue",
    "acceptedAllowlistedSkillDataPoints",
    "unknownOrMissingSkillLabelDataPoints",
  ] as const) {
    incrementDiagnostic(diagnostics, counter, requestDiagnostics[counter]);
  }
  diagnostics.counterSaturationObserved ||=
    requestDiagnostics.counterSaturationObserved;
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

function readOptionalStringAttribute(
  attributes: unknown[],
  requiredKey: "skill" | "status",
): string | undefined {
  const matchingAttributes: UnknownRecord[] = [];
  for (const candidate of attributes) {
    const attribute = requireRecord(candidate);
    if (attribute.key === requiredKey) {
      matchingAttributes.push(attribute);
    }
  }
  if (matchingAttributes.length === 0) {
    return undefined;
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

function hasOwn(record: UnknownRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function hasNoRecordedValueFlag(point: UnknownRecord): boolean | undefined {
  if (!hasOwn(point, "flags")) {
    return false;
  }
  if (
    typeof point.flags !== "number" ||
    !Number.isInteger(point.flags) ||
    point.flags < 0 ||
    point.flags > MAX_UINT32
  ) {
    return undefined;
  }
  return point.flags % 2 === NO_RECORDED_VALUE_FLAG;
}

function readRecordedValueObservation(
  point: UnknownRecord,
): RecordedValueObservation {
  const noRecordedValue = hasNoRecordedValueFlag(point);
  if (noRecordedValue === undefined) {
    return { kind: "unsupported-or-missing" };
  }
  if (noRecordedValue) {
    return { kind: "no-recorded-value" };
  }
  const hasIntegerValue = hasOwn(point, "asInt");
  const hasDoubleValue = hasOwn(point, "asDouble");
  if (hasIntegerValue === hasDoubleValue) {
    return { kind: "unsupported-or-missing" };
  }

  if (hasIntegerValue) {
    if (
      typeof point.asInt !== "string" ||
      point.asInt.length > 20 ||
      !decimalInteger.test(point.asInt)
    ) {
      return { kind: "unsupported-or-missing" };
    }
    const value = BigInt(point.asInt);
    if (value < MIN_INT64 || value > MAX_INT64) {
      return { kind: "unsupported-or-missing" };
    }
    return {
      kind: "recorded",
      sign: value > 0n ? "positive" : value === 0n ? "zero" : "negative",
    };
  }

  if (typeof point.asDouble !== "number" || !Number.isFinite(point.asDouble)) {
    return { kind: "unsupported-or-missing" };
  }
  return {
    kind: "recorded",
    sign:
      point.asDouble > 0
        ? "positive"
        : point.asDouble === 0
          ? "zero"
          : "negative",
  };
}

function inspectMetricDataPoints(
  metric: UnknownRecord,
  diagnostics: MutableDiagnostics,
): void {
  for (const aggregationName of [
    "gauge",
    "sum",
    "histogram",
    "exponentialHistogram",
    "summary",
  ] as const) {
    if (!hasOwn(metric, aggregationName)) {
      continue;
    }
    const aggregation = requireRecord(metric[aggregationName]);
    const dataPoints =
      aggregation.dataPoints === undefined
        ? []
        : requireArray(aggregation.dataPoints);
    incrementDiagnostic(
      diagnostics,
      "metricDataPointsInspected",
      dataPoints.length,
    );
  }
}

function parseRequestObservation(
  payload: unknown,
  allowedSkills: ReadonlySet<string>,
  diagnostics: MutableDiagnostics,
): ParsedRequestObservation {
  const root = requireRecord(payload);
  const injectedSkills = new Set<string>();
  let unrecognizedSkillObserved = false;
  let unsupportedValueObserved = false;

  for (const resourceCandidate of requireArray(root.resourceMetrics)) {
    incrementDiagnostic(diagnostics, "resourceMetricsEntriesInspected");
    const resourceMetric = requireRecord(resourceCandidate);
    for (const scopeCandidate of requireArray(resourceMetric.scopeMetrics)) {
      incrementDiagnostic(diagnostics, "scopeMetricsEntriesInspected");
      const scopeMetric = requireRecord(scopeCandidate);
      for (const metricCandidate of requireArray(scopeMetric.metrics)) {
        incrementDiagnostic(diagnostics, "metricsInspected");
        const metric = requireRecord(metricCandidate);
        if (typeof metric.name !== "string") {
          throw malformedPayload();
        }
        inspectMetricDataPoints(metric, diagnostics);
        if (metric.name !== TARGET_METRIC_NAME) {
          continue;
        }

        incrementDiagnostic(diagnostics, "targetMetricsObserved");

        const sum = requireRecord(metric.sum);
        const dataPoints =
          sum.dataPoints === undefined ? [] : requireArray(sum.dataPoints);
        for (const pointCandidate of dataPoints) {
          incrementDiagnostic(diagnostics, "targetDataPointsObserved");
          const point = requireRecord(pointCandidate);
          const attributes = requireArray(point.attributes);
          const skill = readOptionalStringAttribute(attributes, "skill");
          const status = readOptionalStringAttribute(attributes, "status");
          if (status === "ok") {
            incrementDiagnostic(diagnostics, "targetDataPointsWithStatusOk");
          } else if (status === "error") {
            incrementDiagnostic(diagnostics, "targetDataPointsWithStatusError");
          } else {
            incrementDiagnostic(
              diagnostics,
              "targetDataPointsWithOtherOrMissingStatus",
            );
          }

          const skillAllowed = skill !== undefined && allowedSkills.has(skill);
          if (skill === undefined || !skillAllowed) {
            incrementDiagnostic(
              diagnostics,
              "unknownOrMissingSkillLabelDataPoints",
            );
          }

          const valueObservation = readRecordedValueObservation(point);
          if (valueObservation.kind === "no-recorded-value") {
            incrementDiagnostic(
              diagnostics,
              "targetDataPointsWithNoRecordedValue",
            );
            continue;
          }
          if (valueObservation.kind === "unsupported-or-missing") {
            incrementDiagnostic(
              diagnostics,
              "targetDataPointsWithUnsupportedOrMissingValue",
            );
            unsupportedValueObserved = true;
            continue;
          }
          const valueSign = valueObservation.sign;
          if (valueSign === "positive") {
            incrementDiagnostic(diagnostics, "positiveTargetDataPoints");
          } else if (valueSign === "zero") {
            incrementDiagnostic(diagnostics, "zeroTargetDataPoints");
          } else {
            incrementDiagnostic(diagnostics, "negativeTargetDataPoints");
          }

          if (status !== "ok" || valueSign !== "positive") {
            continue;
          }
          if (skillAllowed && skill !== undefined) {
            injectedSkills.add(skill);
            incrementDiagnostic(
              diagnostics,
              "acceptedAllowlistedSkillDataPoints",
            );
          } else if (skill !== undefined) {
            unrecognizedSkillObserved = true;
          }
        }
      }
    }
  }

  if (unsupportedValueObserved) {
    injectedSkills.clear();
    unrecognizedSkillObserved = false;
    diagnostics.acceptedAllowlistedSkillDataPoints = 0;
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
  const diagnostics = createZeroDiagnostics();
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

    incrementDiagnostic(diagnostics, "otlpMetricsRequestsReceived");
    const completeRequest = trackRequest();
    const chunks: Buffer[] = [];
    let receivedBytes = 0;
    let requestTooLarge = false;
    let requestDiscarded = false;
    let decodeOutcomeRecorded = false;

    const recordDecodeFailure = (failureCounter: DecodeFailureCounter) => {
      if (!decodeOutcomeRecorded) {
        decodeOutcomeRecorded = true;
        incrementDiagnostic(diagnostics, "decodeFailures");
        incrementDiagnostic(diagnostics, failureCounter);
      }
    };

    const discardAbortedRequest = () => {
      requestDiscarded = true;
      chunks.length = 0;
      recordDecodeFailure("requestReadFailures");
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
          recordDecodeFailure("requestBodyTooLargeFailures");
          response.writeHead(413).end();
          return;
        }

        const requestDiagnostics = createZeroDiagnostics();
        let payload: unknown;
        try {
          payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          recordDecodeFailure("jsonParseFailures");
          response.writeHead(400).end();
          return;
        }
        try {
          const requestObservation = parseRequestObservation(
            payload,
            allowedSkills,
            requestDiagnostics,
          );
          for (const skill of requestObservation.injectedSkills) {
            injectedSkills.add(skill);
          }
          unrecognizedSkillObserved ||=
            requestObservation.unrecognizedSkillObserved;
          mergeDiagnostics(diagnostics, requestDiagnostics);
          decodeOutcomeRecorded = true;
          incrementDiagnostic(diagnostics, "successfullyDecodedRequests");
          response.writeHead(200, { "content-type": "application/json" });
          response.end("{}\n");
        } catch {
          mergeDiagnostics(diagnostics, requestDiagnostics);
          recordDecodeFailure("otlpValidationFailures");
          response.writeHead(400).end();
        }
      } catch {
        recordDecodeFailure("requestReadFailures");
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

  function createDiagnosticsSnapshot(): CodexSkillEvidenceDiagnosticsSnapshot {
    return Object.freeze({
      schemaVersion: 1 as const,
      otlpMetricsRequestsReceived: diagnostics.otlpMetricsRequestsReceived,
      successfullyDecodedRequests: diagnostics.successfullyDecodedRequests,
      decodeFailures: diagnostics.decodeFailures,
      requestReadFailures: diagnostics.requestReadFailures,
      requestBodyTooLargeFailures: diagnostics.requestBodyTooLargeFailures,
      jsonParseFailures: diagnostics.jsonParseFailures,
      otlpValidationFailures: diagnostics.otlpValidationFailures,
      resourceMetricsEntriesInspected:
        diagnostics.resourceMetricsEntriesInspected,
      scopeMetricsEntriesInspected: diagnostics.scopeMetricsEntriesInspected,
      metricsInspected: diagnostics.metricsInspected,
      metricDataPointsInspected: diagnostics.metricDataPointsInspected,
      targetMetricsObserved: diagnostics.targetMetricsObserved,
      targetDataPointsObserved: diagnostics.targetDataPointsObserved,
      targetDataPointsWithStatusOk: diagnostics.targetDataPointsWithStatusOk,
      targetDataPointsWithStatusError:
        diagnostics.targetDataPointsWithStatusError,
      targetDataPointsWithOtherOrMissingStatus:
        diagnostics.targetDataPointsWithOtherOrMissingStatus,
      positiveTargetDataPoints: diagnostics.positiveTargetDataPoints,
      zeroTargetDataPoints: diagnostics.zeroTargetDataPoints,
      negativeTargetDataPoints: diagnostics.negativeTargetDataPoints,
      targetDataPointsWithNoRecordedValue:
        diagnostics.targetDataPointsWithNoRecordedValue,
      targetDataPointsWithUnsupportedOrMissingValue:
        diagnostics.targetDataPointsWithUnsupportedOrMissingValue,
      acceptedAllowlistedSkillDataPoints:
        diagnostics.acceptedAllowlistedSkillDataPoints,
      unknownOrMissingSkillLabelDataPoints:
        diagnostics.unknownOrMissingSkillLabelDataPoints,
      counterSaturationObserved: diagnostics.counterSaturationObserved,
    });
  }

  return {
    endpoint: `http://127.0.0.1:${address.port}/v1/metrics`,
    diagnosticsSnapshot: createDiagnosticsSnapshot,
    closeAndSnapshot: async () => {
      shutdownPromise ??= drainAndClose();
      await shutdownPromise;
      return createDefensiveSnapshot();
    },
  };
}
