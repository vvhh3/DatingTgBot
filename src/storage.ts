import crypto from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ModerationStatus, SubmissionContentType, SubmissionRecord } from "./types.js";

const dataDir = path.resolve("data");
const databaseFile = path.join(dataDir, "submissions.db");

type SubmissionRow = {
  id: string;
  user_id: number;
  username: string | null;
  first_name: string | null;
  text: string;
  content_type: SubmissionContentType;
  photo_file_id: string | null;
  video_file_id: string | null;
  created_at: string;
  status: ModerationStatus;
  moderation_message_id: number | null;
  published_message_id: number | null;
  rejection_reason: string | null;
  moderated_by_user_id: number | null;
  moderated_by_username: string | null;
  moderated_by_first_name: string | null;
  moderated_at: string | null;
};

type TableColumnInfo = {
  name: string;
};

mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(databaseFile);

db.exec(`
  CREATE TABLE IF NOT EXISTS submissions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    username TEXT,
    first_name TEXT,
    text TEXT NOT NULL,
    content_type TEXT NOT NULL DEFAULT 'text',
    photo_file_id TEXT,
    video_file_id TEXT,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL,
    moderation_message_id INTEGER,
    published_message_id INTEGER,
    rejection_reason TEXT,
    moderated_by_user_id INTEGER,
    moderated_by_username TEXT,
    moderated_by_first_name TEXT,
    moderated_at TEXT
  )
`);

function ensureColumn(columnName: string, definition: string): void {
  const columns = db.prepare("PRAGMA table_info(submissions)").all() as TableColumnInfo[];

  if (columns.some((column) => column.name === columnName)) {
    return;
  }

  db.exec(`ALTER TABLE submissions ADD COLUMN ${columnName} ${definition}`);
}

ensureColumn("content_type", "TEXT NOT NULL DEFAULT 'text'");
ensureColumn("photo_file_id", "TEXT");
ensureColumn("video_file_id", "TEXT");
ensureColumn("moderated_by_user_id", "INTEGER");
ensureColumn("moderated_by_username", "TEXT");
ensureColumn("moderated_by_first_name", "TEXT");
ensureColumn("moderated_at", "TEXT");

const insertSubmissionStatement = db.prepare(`
  INSERT INTO submissions (
    id,
    user_id,
    username,
    first_name,
    text,
    content_type,
    photo_file_id,
    video_file_id,
    created_at,
    status,
    moderation_message_id,
    published_message_id,
    rejection_reason,
    moderated_by_user_id,
    moderated_by_username,
    moderated_by_first_name,
    moderated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const selectSubmissionStatement = db.prepare(`
  SELECT
    id,
    user_id,
    username,
    first_name,
    text,
    content_type,
    photo_file_id,
    video_file_id,
    created_at,
    status,
    moderation_message_id,
    published_message_id,
    rejection_reason,
    moderated_by_user_id,
    moderated_by_username,
    moderated_by_first_name,
    moderated_at
  FROM submissions
  WHERE id = ?
`);

const updateSubmissionStatement = db.prepare(`
  UPDATE submissions
  SET
    user_id = ?,
    username = ?,
    first_name = ?,
    text = ?,
    content_type = ?,
    photo_file_id = ?,
    video_file_id = ?,
    created_at = ?,
    status = ?,
    moderation_message_id = ?,
    published_message_id = ?,
    rejection_reason = ?,
    moderated_by_user_id = ?,
    moderated_by_username = ?,
    moderated_by_first_name = ?,
    moderated_at = ?
  WHERE id = ?
`);

function rowToSubmission(row: SubmissionRow | undefined): SubmissionRecord | undefined {
  if (!row) {
    return undefined;
  }

  return {
    id: row.id,
    userId: row.user_id,
    username: row.username ?? undefined,
    firstName: row.first_name ?? undefined,
    text: row.text,
    contentType: row.content_type,
    photoFileId: row.photo_file_id ?? undefined,
    videoFileId: row.video_file_id ?? undefined,
    createdAt: row.created_at,
    status: row.status,
    moderationMessageId: row.moderation_message_id ?? undefined,
    publishedMessageId: row.published_message_id ?? undefined,
    rejectionReason: row.rejection_reason ?? undefined,
    moderatedByUserId: row.moderated_by_user_id ?? undefined,
    moderatedByUsername: row.moderated_by_username ?? undefined,
    moderatedByFirstName: row.moderated_by_first_name ?? undefined,
    moderatedAt: row.moderated_at ?? undefined
  };
}

function submissionToParams(record: SubmissionRecord): Array<number | string | null> {
  return [
    record.userId,
    record.username ?? null,
    record.firstName ?? null,
    record.text,
    record.contentType,
    record.photoFileId ?? null,
    record.videoFileId ?? null,
    record.createdAt,
    record.status,
    record.moderationMessageId ?? null,
    record.publishedMessageId ?? null,
    record.rejectionReason ?? null,
    record.moderatedByUserId ?? null,
    record.moderatedByUsername ?? null,
    record.moderatedByFirstName ?? null,
    record.moderatedAt ?? null
  ];
}

export async function createSubmission(
  payload: Omit<SubmissionRecord, "id" | "createdAt" | "status">
): Promise<SubmissionRecord> {
  const record: SubmissionRecord = {
    ...payload,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    status: "pending"
  };

  insertSubmissionStatement.run(record.id, ...submissionToParams(record));
  return record;
}

export async function getSubmission(id: string): Promise<SubmissionRecord | undefined> {
  return rowToSubmission(selectSubmissionStatement.get(id) as SubmissionRow | undefined);
}

export async function updateSubmission(
  id: string,
  updates: Partial<SubmissionRecord>
): Promise<SubmissionRecord | undefined> {
  const existingRecord = await getSubmission(id);

  if (!existingRecord) {
    return undefined;
  }

  const nextRecord: SubmissionRecord = {
    ...existingRecord,
    ...updates,
    id: existingRecord.id
  };

  updateSubmissionStatement.run(...submissionToParams(nextRecord), nextRecord.id);
  return nextRecord;
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
