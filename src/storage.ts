import crypto from "node:crypto";
import { Pool } from "pg";
import { config } from "./config.js";
import type { ModerationStatus, SubmissionContentType, SubmissionRecord } from "./types.js";

type SubmissionRow = {
  id: string;
  user_id: number | string;
  username: string | null;
  first_name: string | null;
  text: string;
  content_type: SubmissionContentType;
  photo_file_id: string | null;
  video_file_id: string | null;
  created_at: string | Date;
  status: ModerationStatus;
  moderation_message_id: number | null;
  published_message_id: number | null;
  rejection_reason: string | null;
  moderated_by_user_id: number | string | null;
  moderated_by_username: string | null;
  moderated_by_first_name: string | null;
  moderated_at: string | Date | null;
};

type SubmissionStatsRow = {
  total: string;
  pending: string;
  approved: string;
  rejected: string;
  text_count: string;
  photo_count: string;
  video_count: string;
};

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined
});

let schemaReadyPromise: Promise<void> | undefined;

function ensureSchemaReady(): Promise<void> {
  if (!schemaReadyPromise) {
    schemaReadyPromise = initializeSchema();
  }

  return schemaReadyPromise;
}

async function initializeSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY,
      user_id BIGINT NOT NULL,
      username TEXT,
      first_name TEXT,
      text TEXT NOT NULL,
      content_type TEXT NOT NULL DEFAULT 'text',
      photo_file_id TEXT,
      video_file_id TEXT,
      created_at TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL,
      moderation_message_id INTEGER,
      published_message_id INTEGER,
      rejection_reason TEXT,
      moderated_by_user_id BIGINT,
      moderated_by_username TEXT,
      moderated_by_first_name TEXT,
      moderated_at TIMESTAMPTZ
    )
  `);

  await pool.query(`
    ALTER TABLE submissions
      ADD COLUMN IF NOT EXISTS content_type TEXT NOT NULL DEFAULT 'text',
      ADD COLUMN IF NOT EXISTS photo_file_id TEXT,
      ADD COLUMN IF NOT EXISTS video_file_id TEXT,
      ADD COLUMN IF NOT EXISTS moderated_by_user_id BIGINT,
      ADD COLUMN IF NOT EXISTS moderated_by_username TEXT,
      ADD COLUMN IF NOT EXISTS moderated_by_first_name TEXT,
      ADD COLUMN IF NOT EXISTS moderated_at TIMESTAMPTZ
  `);
}

function normalizeDate(value: string | Date | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  return value instanceof Date ? value.toISOString() : value;
}

function normalizeBigInt(value: number | string | null | undefined): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  return typeof value === "number" ? value : Number(value);
}

function rowToSubmission(row: SubmissionRow | undefined): SubmissionRecord | undefined {
  if (!row) {
    return undefined;
  }

  return {
    id: row.id,
    userId: normalizeBigInt(row.user_id) as number,
    username: row.username ?? undefined,
    firstName: row.first_name ?? undefined,
    text: row.text,
    contentType: row.content_type,
    photoFileId: row.photo_file_id ?? undefined,
    videoFileId: row.video_file_id ?? undefined,
    createdAt: normalizeDate(row.created_at) as string,
    status: row.status,
    moderationMessageId: row.moderation_message_id ?? undefined,
    publishedMessageId: row.published_message_id ?? undefined,
    rejectionReason: row.rejection_reason ?? undefined,
    moderatedByUserId: normalizeBigInt(row.moderated_by_user_id),
    moderatedByUsername: row.moderated_by_username ?? undefined,
    moderatedByFirstName: row.moderated_by_first_name ?? undefined,
    moderatedAt: normalizeDate(row.moderated_at)
  };
}

function submissionToParams(record: SubmissionRecord): Array<number | string | null> {
  return [
    String(record.userId),
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
    record.moderatedByUserId !== undefined ? String(record.moderatedByUserId) : null,
    record.moderatedByUsername ?? null,
    record.moderatedByFirstName ?? null,
    record.moderatedAt ?? null
  ];
}

export async function createSubmission(
  payload: Omit<SubmissionRecord, "id" | "createdAt" | "status">
): Promise<SubmissionRecord> {
  await ensureSchemaReady();

  const record: SubmissionRecord = {
    ...payload,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    status: "pending"
  };

  await pool.query(
    `
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
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
    `,
    [record.id, ...submissionToParams(record)]
  );

  return record;
}

export async function getSubmission(id: string): Promise<SubmissionRecord | undefined> {
  await ensureSchemaReady();

  const result = await pool.query<SubmissionRow>(
    `
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
      WHERE id = $1
    `,
    [id]
  );

  return rowToSubmission(result.rows[0]);
}

export async function updateSubmission(
  id: string,
  updates: Partial<SubmissionRecord>
): Promise<SubmissionRecord | undefined> {
  await ensureSchemaReady();

  const existingRecord = await getSubmission(id);

  if (!existingRecord) {
    return undefined;
  }

  const nextRecord: SubmissionRecord = {
    ...existingRecord,
    ...updates,
    id: existingRecord.id
  };

  await pool.query(
    `
      UPDATE submissions
      SET
        user_id = $1,
        username = $2,
        first_name = $3,
        text = $4,
        content_type = $5,
        photo_file_id = $6,
        video_file_id = $7,
        created_at = $8,
        status = $9,
        moderation_message_id = $10,
        published_message_id = $11,
        rejection_reason = $12,
        moderated_by_user_id = $13,
        moderated_by_username = $14,
        moderated_by_first_name = $15,
        moderated_at = $16
      WHERE id = $17
    `,
    [...submissionToParams(nextRecord), nextRecord.id]
  );

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

export async function getSubmissionStats(): Promise<{
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  textCount: number;
  photoCount: number;
  videoCount: number;
}> {
  await ensureSchemaReady();

  const result = await pool.query<SubmissionStatsRow>(`
    SELECT
      COUNT(*)::text AS total,
      COUNT(*) FILTER (WHERE status = 'pending')::text AS pending,
      COUNT(*) FILTER (WHERE status = 'approved')::text AS approved,
      COUNT(*) FILTER (WHERE status = 'rejected')::text AS rejected,
      COUNT(*) FILTER (WHERE content_type = 'text')::text AS text_count,
      COUNT(*) FILTER (WHERE content_type = 'photo')::text AS photo_count,
      COUNT(*) FILTER (WHERE content_type = 'video')::text AS video_count
    FROM submissions
  `);

  const row = result.rows[0];

  return {
    total: Number(row?.total ?? "0"),
    pending: Number(row?.pending ?? "0"),
    approved: Number(row?.approved ?? "0"),
    rejected: Number(row?.rejected ?? "0"),
    textCount: Number(row?.text_count ?? "0"),
    photoCount: Number(row?.photo_count ?? "0"),
    videoCount: Number(row?.video_count ?? "0")
  };
}
