import crypto from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Pool } from "pg";
import { config } from "../config/index.js";
import type { ModerationStatus, SubmissionContentType, SubmissionRecord } from "../shared/types.js";

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
  user_pending_message_id: number | null;
  rejection_reason: string | null;
  moderated_by_user_id: number | string | null;
  moderated_by_username: string | null;
  moderated_by_first_name: string | null;
  moderated_at: string | Date | null;
};

type SubmissionStats = {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  cancelled: number;
  textCount: number;
  photoCount: number;
  videoCount: number;
};

export type BannedUserRecord = {
  userId: number;
  username?: string;
  firstName?: string;
  bannedByUserId: number;
  bannedByUsername?: string;
  bannedByFirstName?: string;
  bannedAt: string;
};

type StorageBackend = {
  initialize(): Promise<void>
  createSubmission(payload: Omit<SubmissionRecord, "id" | "createdAt" | "status">): Promise<SubmissionRecord>
  getSubmission(id: string): Promise<SubmissionRecord | undefined>
  updateSubmission(id: string, updates: Partial<SubmissionRecord>): Promise<SubmissionRecord | undefined>
  getSubmissionStats(): Promise<SubmissionStats>
  banUser(payload: Omit<BannedUserRecord, "bannedAt">): Promise<BannedUserRecord>
  unbanUser(userId: number): Promise<boolean>
  isUserBanned(userId: number): Promise<boolean>
  getBannedUsers(): Promise<BannedUserRecord[]>
  getUserInfo(userId: number): Promise<{ userId: number; username?: string; firstName?: string; } | undefined>;
};

function normalizeDate(value: string | Date | null | undefined): string | undefined {
  // Разные базы возвращают даты в разных форматах.
  // На выходе storage всегда отдаёт ISO-строку, чтобы остальной код не думал о backend-е.
  if (!value) {
    return undefined;
  }

  return value instanceof Date ? value.toISOString() : value;
}

function normalizeBigInt(value: number | string | null | undefined): number | undefined {
  // BIGINT из Postgres часто приходит строкой, SQLite обычно отдаёт number.
  if (value === null || value === undefined) {
    return undefined;
  }

  return typeof value === "number" ? value : Number(value);
}

function rowToSubmission(row: SubmissionRow | undefined): SubmissionRecord | undefined {
  if (!row) {
    return undefined;
  }

  // Централизованно переводим snake_case из БД в camelCase доменной модели.
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
    userPendingMessageId: row.user_pending_message_id ?? undefined,
    rejectionReason: row.rejection_reason ?? undefined,
    moderatedByUserId: normalizeBigInt(row.moderated_by_user_id),
    moderatedByUsername: row.moderated_by_username ?? undefined,
    moderatedByFirstName: row.moderated_by_first_name ?? undefined,
    moderatedAt: normalizeDate(row.moderated_at)
  };
}

function buildNewSubmissionRecord(
  payload: Omit<SubmissionRecord, "id" | "createdAt" | "status">
): SubmissionRecord {
  // Идентификатор и время создания принадлежат storage-слою:
  // вызывающий код описывает только содержимое заявки.
  return {
    ...payload,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    status: "pending"
  };
}

function rowToBannedUser(row: {
  user_id: number | string;
  username?: string| null;
  first_name?: string| null;
  banned_by_user_id: number | string;
  banned_by_username: string | null;
  banned_by_first_name: string | null;
  banned_at: string | Date;
}): BannedUserRecord {
  return {
    userId: normalizeBigInt(row.user_id) as number,
    username: row.username ?? undefined,
    firstName: row.first_name ?? undefined,
    bannedByUserId: normalizeBigInt(row.banned_by_user_id) as number,
    bannedByUsername: row.banned_by_username ?? undefined,
    bannedByFirstName: row.banned_by_first_name ?? undefined,
    bannedAt: normalizeDate(row.banned_at) as string
  };
}

class PostgresStorage implements StorageBackend {
  private readonly pool = new Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined
  });

  async initialize(): Promise<void> {
    // Минимальная автоподготовка схемы. Это позволяет запускать бота без отдельного шага миграции.
    await this.pool.query(`
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
        user_pending_message_id INTEGER,
        rejection_reason TEXT,
        moderated_by_user_id BIGINT,
        moderated_by_username TEXT,
        moderated_by_first_name TEXT,
        moderated_at TIMESTAMPTZ
      )
    `);

    await this.pool.query(`
      ALTER TABLE submissions
        ADD COLUMN IF NOT EXISTS content_type TEXT NOT NULL DEFAULT 'text',
        ADD COLUMN IF NOT EXISTS photo_file_id TEXT,
        ADD COLUMN IF NOT EXISTS video_file_id TEXT,
        ADD COLUMN IF NOT EXISTS user_pending_message_id INTEGER,
        ADD COLUMN IF NOT EXISTS moderated_by_user_id BIGINT,
        ADD COLUMN IF NOT EXISTS moderated_by_username TEXT,
        ADD COLUMN IF NOT EXISTS moderated_by_first_name TEXT,
        ADD COLUMN IF NOT EXISTS moderated_at TIMESTAMPTZ
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS banned_users (
        user_id BIGINT PRIMARY KEY,
        username TEXT,
        first_name TEXT,
        banned_by_user_id BIGINT NOT NULL,
        banned_by_username TEXT,
        banned_by_first_name TEXT,
        banned_at TIMESTAMPTZ NOT NULL
      )
    `);

    await this.pool.query(`
      ALTER TABLE banned_users
        ADD COLUMN IF NOT EXISTS username TEXT,
        ADD COLUMN IF NOT EXISTS first_name TEXT
    `);
  }

  async createSubmission(
    payload: Omit<SubmissionRecord, "id" | "createdAt" | "status">
  ): Promise<SubmissionRecord> {
    const record = buildNewSubmissionRecord(payload);

    await this.pool.query(
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
          user_pending_message_id,
          rejection_reason,
          moderated_by_user_id,
          moderated_by_username,
          moderated_by_first_name,
          moderated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      `,
      [
        record.id,
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
        record.userPendingMessageId ?? null,
        record.rejectionReason ?? null,
        record.moderatedByUserId !== undefined ? String(record.moderatedByUserId) : null,
        record.moderatedByUsername ?? null,
        record.moderatedByFirstName ?? null,
        record.moderatedAt ?? null
      ]
    );

    return record;
  }

  async getSubmission(id: string): Promise<SubmissionRecord | undefined> {
    const result = await this.pool.query<SubmissionRow>(
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
          user_pending_message_id,
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

  async updateSubmission(id: string, updates: Partial<SubmissionRecord>): Promise<SubmissionRecord | undefined> {
    const existingRecord = await this.getSubmission(id);

    if (!existingRecord) {
      return undefined;
    }

    // Обновление идёт через merge с текущей записью, потому что вызывающий код обычно меняет
    // только часть полей: статус, moderationMessageId, причину отклонения и т.п.
    const nextRecord: SubmissionRecord = {
      ...existingRecord,
      ...updates,
      id: existingRecord.id
    };

    await this.pool.query(
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
          user_pending_message_id = $12,
          rejection_reason = $13,
          moderated_by_user_id = $14,
          moderated_by_username = $15,
          moderated_by_first_name = $16,
          moderated_at = $17
        WHERE id = $18
      `,
      [
        String(nextRecord.userId),
        nextRecord.username ?? null,
        nextRecord.firstName ?? null,
        nextRecord.text,
        nextRecord.contentType,
        nextRecord.photoFileId ?? null,
        nextRecord.videoFileId ?? null,
        nextRecord.createdAt,
        nextRecord.status,
        nextRecord.moderationMessageId ?? null,
        nextRecord.publishedMessageId ?? null,
        nextRecord.userPendingMessageId ?? null,
        nextRecord.rejectionReason ?? null,
        nextRecord.moderatedByUserId !== undefined ? String(nextRecord.moderatedByUserId) : null,
        nextRecord.moderatedByUsername ?? null,
        nextRecord.moderatedByFirstName ?? null,
        nextRecord.moderatedAt ?? null,
        nextRecord.id
      ]
    );

    return nextRecord;
  }

  async getSubmissionStats(): Promise<SubmissionStats> {
    const result = await this.pool.query<{
      total: string;
      pending: string;
      approved: string;
      rejected: string;
      cancelled: string;
      text_count: string;
      photo_count: string;
      video_count: string;
    }>(`
      SELECT
        COUNT(*)::text AS total,
        COUNT(*) FILTER (WHERE status = 'pending')::text AS pending,
        COUNT(*) FILTER (WHERE status = 'approved')::text AS approved,
        COUNT(*) FILTER (WHERE status = 'rejected')::text AS rejected,
        COUNT(*) FILTER (WHERE status = 'cancelled')::text AS cancelled,
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
      cancelled: Number(row?.cancelled ?? "0"),
      textCount: Number(row?.text_count ?? "0"),
      photoCount: Number(row?.photo_count ?? "0"),
      videoCount: Number(row?.video_count ?? "0")
    };
  }

  async banUser(payload: Omit<BannedUserRecord, "bannedAt">): Promise<BannedUserRecord> {
    const record: BannedUserRecord = {
      ...payload,
      bannedAt: new Date().toISOString()
    };

    const result = await this.pool.query<{
      user_id: string;
      username?: string;
      firstName?: string;
      banned_by_user_id: string;
      banned_by_username: string | null;
      banned_by_first_name: string | null;
      banned_at: Date;
    }>(
      `
        INSERT INTO banned_users (
          user_id,
          username,
          first_name,
          banned_by_user_id,
          banned_by_username,
          banned_by_first_name,
          banned_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (user_id) DO UPDATE
        SET
          username = EXCLUDED.username,
          first_name = EXCLUDED.first_name,
          banned_by_user_id = EXCLUDED.banned_by_user_id,
          banned_by_username = EXCLUDED.banned_by_username,
          banned_by_first_name = EXCLUDED.banned_by_first_name,
          banned_at = EXCLUDED.banned_at
        RETURNING user_id, banned_by_user_id, banned_by_username, banned_by_first_name, banned_at
      `,
      [
        String(record.userId),
        record.username ?? null,
        record.firstName ?? null,
        String(record.bannedByUserId),
        String(record.bannedByUserId),
        record.bannedByUsername ?? null,
        record.bannedByFirstName ?? null,
        record.bannedAt
      ]
    );

    return rowToBannedUser(result.rows[0]);
  }

  async unbanUser(userId: number): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM banned_users WHERE user_id = $1", [String(userId)]);
    return (result.rowCount ?? 0) > 0;
  }

  async isUserBanned(userId: number): Promise<boolean> {
    const result = await this.pool.query("SELECT 1 FROM banned_users WHERE user_id = $1 LIMIT 1", [String(userId)]);
    return (result.rowCount ?? 0) > 0;
  }

  async getBannedUsers(): Promise<BannedUserRecord[]> {
    const result = await this.pool.query(`
    SELECT
      user_id,
      username,
      first_name,
      banned_by_user_id,
      banned_by_username,
      banned_by_first_name,
      banned_at
    FROM banned_users
    ORDER BY banned_at DESC
  `);

    return result.rows.map(row => rowToBannedUser(row));
  }
  async getUserInfo(userId: number) {
    const result = await this.pool.query(
      `
    SELECT user_id, username, first_name
    FROM submissions
    WHERE user_id = $1
    LIMIT 1
    `,
      [String(userId)]
    );

    const row = result.rows[0];
    if (!row) return undefined;

    return {
      userId: Number(row.user_id),
      username: row.username ?? undefined,
      firstName: row.first_name ?? undefined
    };
  }
}

class SqliteStorage implements StorageBackend {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    // Для локальной разработки создаём каталог БД автоматически.
    const resolvedPath = path.resolve(databasePath);
    mkdirSync(path.dirname(resolvedPath), { recursive: true });
    this.db = new DatabaseSync(resolvedPath);
  }

  async initialize(): Promise<void> {
    // Схема повторяет Postgres-структуру, чтобы переключение backend-а не влияло на бизнес-логику.
    this.db.exec(`
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
        user_pending_message_id INTEGER,
        rejection_reason TEXT,
        moderated_by_user_id INTEGER,
        moderated_by_username TEXT,
        moderated_by_first_name TEXT,
        moderated_at TEXT
      )
    `);

    const hasUserPendingMessageIdColumn = this.db
      .prepare(`
        SELECT 1
        FROM pragma_table_info('submissions')
        WHERE name = ?
        LIMIT 1
      `)
      .get("user_pending_message_id");

    if (!hasUserPendingMessageIdColumn) {
      this.db.exec("ALTER TABLE submissions ADD COLUMN user_pending_message_id INTEGER");
    }

    const hasBannedUsersUsernameColumn = this.db
      .prepare(`
        SELECT 1
        FROM pragma_table_info('banned_users')
        WHERE name = ?
        LIMIT 1
      `)
      .get("username");

    if (!hasBannedUsersUsernameColumn) {
      this.db.exec("ALTER TABLE banned_users ADD COLUMN username TEXT");
    }

    const hasBannedUsersFirstNameColumn = this.db
      .prepare(`
        SELECT 1
        FROM pragma_table_info('banned_users')
        WHERE name = ?
        LIMIT 1
      `)
      .get("first_name");

    if (!hasBannedUsersFirstNameColumn) {
      this.db.exec("ALTER TABLE banned_users ADD COLUMN first_name TEXT");
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS banned_users (
        user_id INTEGER PRIMARY KEY,
        username TEXT,
        first_name TEXT,
        banned_by_user_id INTEGER NOT NULL,
        banned_by_username TEXT,
        banned_by_first_name TEXT,
        banned_at TEXT NOT NULL
      )
    `);
  }

  async createSubmission(
    payload: Omit<SubmissionRecord, "id" | "createdAt" | "status">
  ): Promise<SubmissionRecord> {
    const record = buildNewSubmissionRecord(payload);

    this.db
      .prepare(`
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
          user_pending_message_id,
          rejection_reason,
          moderated_by_user_id,
          moderated_by_username,
          moderated_by_first_name,
          moderated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        record.id,
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
        record.userPendingMessageId ?? null,
        record.rejectionReason ?? null,
        record.moderatedByUserId ?? null,
        record.moderatedByUsername ?? null,
        record.moderatedByFirstName ?? null,
        record.moderatedAt ?? null
      );

    return record;
  }

  async getSubmission(id: string): Promise<SubmissionRecord | undefined> {
    const row = this.db
      .prepare(`
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
          user_pending_message_id,
          rejection_reason,
          moderated_by_user_id,
          moderated_by_username,
          moderated_by_first_name,
          moderated_at
        FROM submissions
        WHERE id = ?
      `)
      .get(id) as SubmissionRow | undefined;

    return rowToSubmission(row);
  }

  async updateSubmission(id: string, updates: Partial<SubmissionRecord>): Promise<SubmissionRecord | undefined> {
    const existingRecord = await this.getSubmission(id);

    if (!existingRecord) {
      return undefined;
    }

    const nextRecord: SubmissionRecord = {
      ...existingRecord,
      ...updates,
      id: existingRecord.id
    };

    this.db
      .prepare(`
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
          user_pending_message_id = ?,
          rejection_reason = ?,
          moderated_by_user_id = ?,
          moderated_by_username = ?,
          moderated_by_first_name = ?,
          moderated_at = ?
        WHERE id = ?
      `)
      .run(
        nextRecord.userId,
        nextRecord.username ?? null,
        nextRecord.firstName ?? null,
        nextRecord.text,
        nextRecord.contentType,
        nextRecord.photoFileId ?? null,
        nextRecord.videoFileId ?? null,
        nextRecord.createdAt,
        nextRecord.status,
        nextRecord.moderationMessageId ?? null,
        nextRecord.publishedMessageId ?? null,
        nextRecord.userPendingMessageId ?? null,
        nextRecord.rejectionReason ?? null,
        nextRecord.moderatedByUserId ?? null,
        nextRecord.moderatedByUsername ?? null,
        nextRecord.moderatedByFirstName ?? null,
        nextRecord.moderatedAt ?? null,
        nextRecord.id
      );

    return nextRecord;
  }

  async getSubmissionStats(): Promise<SubmissionStats> {
    const row = this.db
      .prepare(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approved,
          SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
          SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
          SUM(CASE WHEN content_type = 'text' THEN 1 ELSE 0 END) AS text_count,
          SUM(CASE WHEN content_type = 'photo' THEN 1 ELSE 0 END) AS photo_count,
          SUM(CASE WHEN content_type = 'video' THEN 1 ELSE 0 END) AS video_count
        FROM submissions
      `)
      .get() as
      | {
        total: number | null;
        pending: number | null;
        approved: number | null;
        rejected: number | null;
        cancelled: number | null;
        text_count: number | null;
        photo_count: number | null;
        video_count: number | null;
      }
      | undefined;

    return {
      total: Number(row?.total ?? 0),
      pending: Number(row?.pending ?? 0),
      approved: Number(row?.approved ?? 0),
      rejected: Number(row?.rejected ?? 0),
      cancelled: Number(row?.cancelled ?? 0),
      textCount: Number(row?.text_count ?? 0),
      photoCount: Number(row?.photo_count ?? 0),
      videoCount: Number(row?.video_count ?? 0)
    };
  }

  async banUser(payload: Omit<BannedUserRecord, "bannedAt">): Promise<BannedUserRecord> {
    const record: BannedUserRecord = {
      ...payload,
      bannedAt: new Date().toISOString()
    };

    this.db
      .prepare(`
        INSERT INTO banned_users (
          user_id,
          username,
          first_name,
          banned_by_user_id,
          banned_by_username,
          banned_by_first_name,
          banned_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          banned_by_user_id = excluded.banned_by_user_id,
          banned_by_username = excluded.banned_by_username,
          banned_by_first_name = excluded.banned_by_first_name,
          banned_at = excluded.banned_at
      `)
      .run(
        record.userId,
        record.username ?? null,
        record.firstName ?? null,
        record.bannedByUserId,
        record.bannedByUsername ?? null,
        record.bannedByFirstName ?? null,
        record.bannedAt
      );

    return record;
  }

  async unbanUser(userId: number): Promise<boolean> {
    const result = this.db.prepare("DELETE FROM banned_users WHERE user_id = ?").run(userId);
    return result.changes > 0;
  }

  async isUserBanned(userId: number): Promise<boolean> {
    const row = this.db.prepare("SELECT 1 FROM banned_users WHERE user_id = ? LIMIT 1").get(userId);
    return Boolean(row);
  }

  async getBannedUsers(): Promise<BannedUserRecord[]> {
    const rows = this.db
      .prepare(`
      SELECT
        user_id,
        username,
        first_name,
        banned_by_user_id,
        banned_by_username,
        banned_by_first_name,
        banned_at
      FROM banned_users
      ORDER BY banned_at DESC
    `)
      .all() as {
        user_id: number;
        username: string | null;
        first_name: string | null;
        banned_by_user_id: number;
        banned_by_username: string | null;
        banned_by_first_name: string | null;
        banned_at: string;
      }[];

    return rows.map(row => rowToBannedUser(row));
  }
  async getUserInfo(userId: number) {
    const row = this.db.prepare(`
    SELECT user_id, username, first_name
    FROM submissions
    WHERE user_id = ?
    LIMIT 1
  `).get(userId) as any;

    if (!row) return undefined;

    return {
      userId: row.user_id,
      username: row.username ?? undefined,
      firstName: row.first_name ?? undefined
    };
  }
}

const backend: StorageBackend = config.databaseUrl
  ? new PostgresStorage()
  : new SqliteStorage(config.sqlitePath);

let schemaReadyPromise: Promise<void> | undefined;

function ensureSchemaReady(): Promise<void> {
  if (!schemaReadyPromise) {
    // Кэшируем именно Promise, чтобы параллельные первые обращения ждали одну и ту же инициализацию.
    schemaReadyPromise = backend.initialize();
  }

  return schemaReadyPromise;
}

export async function createSubmission(
  payload: Omit<SubmissionRecord, "id" | "createdAt" | "status">
): Promise<SubmissionRecord> {
  await ensureSchemaReady();
  return backend.createSubmission(payload);
}

export async function getSubmission(id: string): Promise<SubmissionRecord | undefined> {
  await ensureSchemaReady();
  return backend.getSubmission(id);
}

export async function updateSubmission(
  id: string,
  updates: Partial<SubmissionRecord>
): Promise<SubmissionRecord | undefined> {
  await ensureSchemaReady();
  return backend.updateSubmission(id, updates);
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

export async function getSubmissionStats(): Promise<SubmissionStats> {
  await ensureSchemaReady();
  return backend.getSubmissionStats();
}

export async function banUser(payload: Omit<BannedUserRecord, "bannedAt">): Promise<BannedUserRecord> {
  await ensureSchemaReady();
  return backend.banUser(payload);
}

export async function unbanUser(userId: number): Promise<boolean> {
  await ensureSchemaReady();
  return backend.unbanUser(userId);
}

export async function isUserBanned(userId: number): Promise<boolean> {
  await ensureSchemaReady();
  return backend.isUserBanned(userId);
}

export async function getBannedUsers(): Promise<BannedUserRecord[]> {
  await ensureSchemaReady();
  return backend.getBannedUsers();
}

export async function getUserInfo(userId: number) {
  await ensureSchemaReady();
  return backend.getUserInfo(userId);
}