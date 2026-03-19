import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { ModerationStatus, SubmissionRecord } from "./types.js";

const dataDir = path.resolve("data");
const dataFile = path.join(dataDir, "submissions.json");

async function ensureStorageFile(): Promise<void> {
  await mkdir(dataDir, { recursive: true });

  try {
    await readFile(dataFile, "utf8");
  } catch {
    await writeFile(dataFile, "[]", "utf8");
  }
}

async function readAll(): Promise<SubmissionRecord[]> {
  await ensureStorageFile();
  const content = await readFile(dataFile, "utf8");

  try {
    return JSON.parse(content) as SubmissionRecord[];
  } catch {
    return [];
  }
}

async function writeAll(records: SubmissionRecord[]): Promise<void> {
  await ensureStorageFile();
  await writeFile(dataFile, JSON.stringify(records, null, 2), "utf8");
}

export async function createSubmission(
  payload: Omit<SubmissionRecord, "id" | "createdAt" | "status">
): Promise<SubmissionRecord> {
  const records = await readAll();
  const record: SubmissionRecord = {
    ...payload,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    status: "pending"
  };

  records.push(record);
  await writeAll(records);
  return record;
}

export async function getSubmission(id: string): Promise<SubmissionRecord | undefined> {
  const records = await readAll();
  return records.find((record) => record.id === id);
}

export async function updateSubmission(
  id: string,
  updates: Partial<SubmissionRecord>
): Promise<SubmissionRecord | undefined> {
  const records = await readAll();
  const index = records.findIndex((record) => record.id === id);

  if (index === -1) {
    return undefined;
  }

  records[index] = {
    ...records[index],
    ...updates
  };

  await writeAll(records);
  return records[index];
}

export async function updateModerationStatus(
  id: string,
  status: ModerationStatus,
  extra: Partial<SubmissionRecord> = {}
): Promise<SubmissionRecord | undefined> {
  return updateSubmission(id, {
    status,
    ...extra
  });
}
