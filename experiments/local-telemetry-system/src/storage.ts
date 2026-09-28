import {
  openSync,
  readFileSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  renameSync,
  existsSync,
} from "node:fs";
import { observation, type Observation } from "./record.js";

/** Only already-reduced observations reach disk. Revalidate after restart. */
export function readRecords(path: string): Observation[] {
  if (!existsSync(path)) return [];
  const bytes = readFileSync(path);
  if (bytes.length > 8 * 1024 * 1024) throw new Error("Storage bound");
  const rows = JSON.parse(bytes.toString("utf8"));
  if (!Array.isArray(rows) || rows.length > 1024)
    throw new Error("Storage bound");
  return rows.map(observation);
}
export function writeRecords(path: string, values: readonly unknown[]) {
  if (values.length > 1024) throw new Error("Storage bound");
  const data = JSON.stringify(values.map(observation));
  if (Buffer.byteLength(data) > 8 * 1024 * 1024)
    throw new Error("Storage bound");
  const fd = openSync(`${path}.tmp`, "w", 0o600);
  try {
    writeFileSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(`${path}.tmp`, path);
}
