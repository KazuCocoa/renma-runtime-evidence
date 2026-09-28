import type { Sample } from "../../codex-plugin-usage/src/collector.js";
/** Derived clock comparison. Neither the provider interval end nor receipt is injection time. */
export function analyzeTiming(samples: readonly Sample[]) {
  const ordered = [...samples].sort((a, b) => a.elapsedMs - b.elapsedMs);
  const lags: number[] = [],
    windows: number[] = [];
  let utcRegressions = 0;
  for (let i = 0; i < ordered.length; i++) {
    const s = ordered[i]!;
    if (i && Date.parse(s.observedAt) < Date.parse(ordered[i - 1]!.observedAt))
      utcRegressions++;
    if (s.timeUnixNano) {
      const endMs = Number(BigInt(s.timeUnixNano) / 1000000n);
      const lag = Date.parse(s.observedAt) - endMs;
      if (Number.isSafeInteger(lag)) lags.push(lag);
      if (s.startTimeUnixNano) {
        const width = Number(
          (BigInt(s.timeUnixNano) - BigInt(s.startTimeUnixNano)) / 1000000n,
        );
        if (Number.isSafeInteger(width) && width >= 0) windows.push(width);
      }
    }
  }
  const range = (values: number[]) =>
    values.length
      ? { min: Math.min(...values), max: Math.max(...values) }
      : null;
  return {
    samples: ordered.length,
    receiverUtcRegressions: utcRegressions,
    sharedReceiptTimestampObserved:
      new Set(ordered.map((s) => s.observedAt)).size < ordered.length,
    providerIntervalEndToReceiptMs: range(lags),
    providerIntervalWidthMs: range(windows),
    exactInjectionTime: "unsupported",
    crossHostClockSynchronization: "not-established",
    orderingBasis: "receiver-monotonic-elapsed-within-one-epoch",
    interpretation: "clock-difference-not-end-to-end-injection-latency",
  };
}
