import crypto from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Pool } from "pg";
import { config } from "../config/index.js";

export type ContestStatus = "active" | "finished";
export type ReferralStatus = "pending" | "confirmed";

export interface ContestRecord {
  id: string;
  status: ContestStatus;
  startedAt: string;
  finishedAt?: string;
  winnerCount: number;
}

export interface ContestParticipantRecord {
  contestId: string;
  userId: number;
  username?: string;
  firstName?: string;
  joinedAt: string;
}

export interface ReferralRecord {
  id: string;
  contestId: string;
  inviterUserId: number;
  invitedUserId: number;
  invitedUsername?: string;
  invitedFirstName?: string;
  startPayload?: string;
  status: ReferralStatus;
  createdAt: string;
  confirmedAt?: string;
}

export interface ContestTicketEntry {
  userId: number;
  username?: string;
  firstName?: string;
  tickets: number;
}

type ContestRow = {
  id: string;
  status: ContestStatus;
  started_at: string | Date;
  finished_at: string | Date | null;
  winner_count: number | string;
};

type ContestParticipantRow = {
  contest_id: string;
  user_id: number | string;
  username: string | null;
  first_name: string | null;
  joined_at: string | Date;
};

type ReferralRow = {
  id: string;
  contest_id: string;
  inviter_user_id: number | string;
  invited_user_id: number | string;
  invited_username: string | null;
  invited_first_name: string | null;
  start_payload: string | null;
  status: ReferralStatus;
  created_at: string | Date;
  confirmed_at: string | Date | null;
};

type ContestTicketRow = {
  user_id: number | string;
  username: string | null;
  first_name: string | null;
  tickets: number | string | null;
};

type RegisterParticipantPayload = {
  contestId: string;
  userId: number;
  username?: string;
  firstName?: string;
};

type CreateReferralPayload = {
  contestId: string;
  inviterUserId: number;
  invitedUserId: number;
  invitedUsername?: string;
  invitedFirstName?: string;
  startPayload?: string;
};

type RegisterParticipantResult = {
  participant: ContestParticipantRecord;
  isNew: boolean;
};

type ContestStorageBackend = {
  initialize(): Promise<void>;
  getActiveContest(): Promise<ContestRecord | undefined>;
  createContest(winnerCount: number): Promise<ContestRecord>;
  finishContest(contestId: string): Promise<ContestRecord | undefined>;
  getContestParticipant(contestId: string, userId: number): Promise<ContestParticipantRecord | undefined>;
  registerContestParticipant(payload: RegisterParticipantPayload): Promise<RegisterParticipantResult>;
  getReferralByInvitedUserId(contestId: string, invitedUserId: number): Promise<ReferralRecord | undefined>;
  createReferralIfFirstSeen(payload: CreateReferralPayload): Promise<ReferralRecord | undefined>;
  confirmReferral(contestId: string, invitedUserId: number): Promise<ReferralRecord | undefined>;
  getConfirmedReferralCount(contestId: string, inviterUserId: number): Promise<number>;
  getContestTicketEntries(contestId: string): Promise<ContestTicketEntry[]>;
};

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

function rowToContest(row: ContestRow | undefined): ContestRecord | undefined {
  if (!row) {
    return undefined;
  }

  return {
    id: row.id,
    status: row.status,
    startedAt: normalizeDate(row.started_at) as string,
    finishedAt: normalizeDate(row.finished_at),
    winnerCount: Number(row.winner_count)
  };
}

function rowToContestParticipant(
  row: ContestParticipantRow | undefined
): ContestParticipantRecord | undefined {
  if (!row) {
    return undefined;
  }

  return {
    contestId: row.contest_id,
    userId: normalizeBigInt(row.user_id) as number,
    username: row.username ?? undefined,
    firstName: row.first_name ?? undefined,
    joinedAt: normalizeDate(row.joined_at) as string
  };
}

function rowToReferral(row: ReferralRow | undefined): ReferralRecord | undefined {
  if (!row) {
    return undefined;
  }

  return {
    id: row.id,
    contestId: row.contest_id,
    inviterUserId: normalizeBigInt(row.inviter_user_id) as number,
    invitedUserId: normalizeBigInt(row.invited_user_id) as number,
    invitedUsername: row.invited_username ?? undefined,
    invitedFirstName: row.invited_first_name ?? undefined,
    startPayload: row.start_payload ?? undefined,
    status: row.status,
    createdAt: normalizeDate(row.created_at) as string,
    confirmedAt: normalizeDate(row.confirmed_at)
  };
}

function rowToTicketEntry(row: ContestTicketRow): ContestTicketEntry {
  return {
    userId: normalizeBigInt(row.user_id) as number,
    username: row.username ?? undefined,
    firstName: row.first_name ?? undefined,
    tickets: Number(row.tickets ?? 0)
  };
}

class PostgresContestStorage implements ContestStorageBackend {
  private readonly pool = new Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined
  });

  async initialize(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS contests (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        started_at TIMESTAMPTZ NOT NULL,
        finished_at TIMESTAMPTZ,
        winner_count INTEGER NOT NULL
      )
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS contest_participants (
        contest_id TEXT NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
        user_id BIGINT NOT NULL,
        username TEXT,
        first_name TEXT,
        joined_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (contest_id, user_id)
      )
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS referrals (
        id TEXT PRIMARY KEY,
        contest_id TEXT NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
        inviter_user_id BIGINT NOT NULL,
        invited_user_id BIGINT NOT NULL,
        invited_username TEXT,
        invited_first_name TEXT,
        start_payload TEXT,
        status TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        confirmed_at TIMESTAMPTZ,
        UNIQUE (contest_id, invited_user_id)
      )
    `);

    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_contests_status ON contests(status)
    `);

    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_referrals_inviter ON referrals(contest_id, inviter_user_id, status)
    `);
  }

  async getActiveContest(): Promise<ContestRecord | undefined> {
    const result = await this.pool.query<ContestRow>(
      `
        SELECT id, status, started_at, finished_at, winner_count
        FROM contests
        WHERE status = 'active'
        ORDER BY started_at DESC
        LIMIT 1
      `
    );

    return rowToContest(result.rows[0]);
  }

  async createContest(winnerCount: number): Promise<ContestRecord> {
    const record: ContestRecord = {
      id: crypto.randomUUID(),
      status: "active",
      startedAt: new Date().toISOString(),
      winnerCount
    };

    await this.pool.query(
      `
        INSERT INTO contests (id, status, started_at, finished_at, winner_count)
        VALUES ($1, $2, $3, $4, $5)
      `,
      [record.id, record.status, record.startedAt, null, record.winnerCount]
    );

    return record;
  }

  async finishContest(contestId: string): Promise<ContestRecord | undefined> {
    const finishedAt = new Date().toISOString();

    const result = await this.pool.query<ContestRow>(
      `
        UPDATE contests
        SET status = 'finished',
            finished_at = $1
        WHERE id = $2
          AND status = 'active'
        RETURNING id, status, started_at, finished_at, winner_count
      `,
      [finishedAt, contestId]
    );

    return rowToContest(result.rows[0]);
  }

  async getContestParticipant(
    contestId: string,
    userId: number
  ): Promise<ContestParticipantRecord | undefined> {
    const result = await this.pool.query<ContestParticipantRow>(
      `
        SELECT contest_id, user_id, username, first_name, joined_at
        FROM contest_participants
        WHERE contest_id = $1 AND user_id = $2
      `,
      [contestId, String(userId)]
    );

    return rowToContestParticipant(result.rows[0]);
  }

  async registerContestParticipant(
    payload: RegisterParticipantPayload
  ): Promise<RegisterParticipantResult> {
    const existing = await this.getContestParticipant(payload.contestId, payload.userId);

    if (existing) {
      await this.pool.query(
        `
          UPDATE contest_participants
          SET username = $1,
              first_name = $2
          WHERE contest_id = $3 AND user_id = $4
        `,
        [payload.username ?? null, payload.firstName ?? null, payload.contestId, String(payload.userId)]
      );

      return {
        participant: {
          ...existing,
          username: payload.username ?? existing.username,
          firstName: payload.firstName ?? existing.firstName
        },
        isNew: false
      };
    }

    const participant: ContestParticipantRecord = {
      contestId: payload.contestId,
      userId: payload.userId,
      username: payload.username,
      firstName: payload.firstName,
      joinedAt: new Date().toISOString()
    };

    await this.pool.query(
      `
        INSERT INTO contest_participants (contest_id, user_id, username, first_name, joined_at)
        VALUES ($1, $2, $3, $4, $5)
      `,
      [
        participant.contestId,
        String(participant.userId),
        participant.username ?? null,
        participant.firstName ?? null,
        participant.joinedAt
      ]
    );

    return { participant, isNew: true };
  }

  async getReferralByInvitedUserId(
    contestId: string,
    invitedUserId: number
  ): Promise<ReferralRecord | undefined> {
    const result = await this.pool.query<ReferralRow>(
      `
        SELECT
          id,
          contest_id,
          inviter_user_id,
          invited_user_id,
          invited_username,
          invited_first_name,
          start_payload,
          status,
          created_at,
          confirmed_at
        FROM referrals
        WHERE contest_id = $1 AND invited_user_id = $2
      `,
      [contestId, String(invitedUserId)]
    );

    return rowToReferral(result.rows[0]);
  }

  async createReferralIfFirstSeen(
    payload: CreateReferralPayload
  ): Promise<ReferralRecord | undefined> {
    const existing = await this.getReferralByInvitedUserId(payload.contestId, payload.invitedUserId);
    if (existing) {
      return existing;
    }

    const referral: ReferralRecord = {
      id: crypto.randomUUID(),
      contestId: payload.contestId,
      inviterUserId: payload.inviterUserId,
      invitedUserId: payload.invitedUserId,
      invitedUsername: payload.invitedUsername,
      invitedFirstName: payload.invitedFirstName,
      startPayload: payload.startPayload,
      status: "pending",
      createdAt: new Date().toISOString()
    };

    await this.pool.query(
      `
        INSERT INTO referrals (
          id,
          contest_id,
          inviter_user_id,
          invited_user_id,
          invited_username,
          invited_first_name,
          start_payload,
          status,
          created_at,
          confirmed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [
        referral.id,
        referral.contestId,
        String(referral.inviterUserId),
        String(referral.invitedUserId),
        referral.invitedUsername ?? null,
        referral.invitedFirstName ?? null,
        referral.startPayload ?? null,
        referral.status,
        referral.createdAt,
        null
      ]
    );

    return referral;
  }

  async confirmReferral(contestId: string, invitedUserId: number): Promise<ReferralRecord | undefined> {
    const result = await this.pool.query<ReferralRow>(
      `
        UPDATE referrals
        SET status = 'confirmed',
            confirmed_at = COALESCE(confirmed_at, $1)
        WHERE contest_id = $2
          AND invited_user_id = $3
        RETURNING
          id,
          contest_id,
          inviter_user_id,
          invited_user_id,
          invited_username,
          invited_first_name,
          start_payload,
          status,
          created_at,
          confirmed_at
      `,
      [new Date().toISOString(), contestId, String(invitedUserId)]
    );

    return rowToReferral(result.rows[0]);
  }

  async getConfirmedReferralCount(contestId: string, inviterUserId: number): Promise<number> {
    const result = await this.pool.query<{ tickets: string }>(
      `
        SELECT COUNT(*)::text AS tickets
        FROM referrals
        WHERE contest_id = $1
          AND inviter_user_id = $2
          AND status = 'confirmed'
      `,
      [contestId, String(inviterUserId)]
    );

    return Number(result.rows[0]?.tickets ?? "0");
  }

  async getContestTicketEntries(contestId: string): Promise<ContestTicketEntry[]> {
    const result = await this.pool.query<ContestTicketRow>(
      `
        SELECT
          p.user_id,
          p.username,
          p.first_name,
          COUNT(r.id)::text AS tickets
        FROM contest_participants p
        LEFT JOIN referrals r
          ON r.contest_id = p.contest_id
         AND r.inviter_user_id = p.user_id
         AND r.status = 'confirmed'
        WHERE p.contest_id = $1
        GROUP BY p.user_id, p.username, p.first_name
        HAVING COUNT(r.id) > 0
        ORDER BY COUNT(r.id) DESC, p.user_id ASC
      `,
      [contestId]
    );

    return result.rows.map(rowToTicketEntry);
  }
}

class SqliteContestStorage implements ContestStorageBackend {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    const resolvedPath = path.resolve(databasePath);
    mkdirSync(path.dirname(resolvedPath), { recursive: true });
    this.db = new DatabaseSync(resolvedPath);
  }

  async initialize(): Promise<void> {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS contests (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        winner_count INTEGER NOT NULL
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS contest_participants (
        contest_id TEXT NOT NULL,
        user_id INTEGER NOT NULL,
        username TEXT,
        first_name TEXT,
        joined_at TEXT NOT NULL,
        PRIMARY KEY (contest_id, user_id)
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS referrals (
        id TEXT PRIMARY KEY,
        contest_id TEXT NOT NULL,
        inviter_user_id INTEGER NOT NULL,
        invited_user_id INTEGER NOT NULL,
        invited_username TEXT,
        invited_first_name TEXT,
        start_payload TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        confirmed_at TEXT,
        UNIQUE (contest_id, invited_user_id)
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_contests_status ON contests(status)
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_referrals_inviter ON referrals(contest_id, inviter_user_id, status)
    `);
  }

  async getActiveContest(): Promise<ContestRecord | undefined> {
    const row = this.db
      .prepare(`
        SELECT id, status, started_at, finished_at, winner_count
        FROM contests
        WHERE status = 'active'
        ORDER BY started_at DESC
        LIMIT 1
      `)
      .get() as ContestRow | undefined;

    return rowToContest(row);
  }

  async createContest(winnerCount: number): Promise<ContestRecord> {
    const record: ContestRecord = {
      id: crypto.randomUUID(),
      status: "active",
      startedAt: new Date().toISOString(),
      winnerCount
    };

    this.db
      .prepare(`
        INSERT INTO contests (id, status, started_at, finished_at, winner_count)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(record.id, record.status, record.startedAt, null, record.winnerCount);

    return record;
  }

  async finishContest(contestId: string): Promise<ContestRecord | undefined> {
    const finishedAt = new Date().toISOString();

    this.db
      .prepare(`
        UPDATE contests
        SET status = 'finished',
            finished_at = ?
        WHERE id = ?
          AND status = 'active'
      `)
      .run(finishedAt, contestId);

    const row = this.db
      .prepare(`
        SELECT id, status, started_at, finished_at, winner_count
        FROM contests
        WHERE id = ?
      `)
      .get(contestId) as ContestRow | undefined;

    return row?.status === "finished" ? rowToContest(row) : undefined;
  }

  async getContestParticipant(
    contestId: string,
    userId: number
  ): Promise<ContestParticipantRecord | undefined> {
    const row = this.db
      .prepare(`
        SELECT contest_id, user_id, username, first_name, joined_at
        FROM contest_participants
        WHERE contest_id = ? AND user_id = ?
      `)
      .get(contestId, userId) as ContestParticipantRow | undefined;

    return rowToContestParticipant(row);
  }

  async registerContestParticipant(
    payload: RegisterParticipantPayload
  ): Promise<RegisterParticipantResult> {
    const existing = await this.getContestParticipant(payload.contestId, payload.userId);

    if (existing) {
      this.db
        .prepare(`
          UPDATE contest_participants
          SET username = ?, first_name = ?
          WHERE contest_id = ? AND user_id = ?
        `)
        .run(
          payload.username ?? null,
          payload.firstName ?? null,
          payload.contestId,
          payload.userId
        );

      return {
        participant: {
          ...existing,
          username: payload.username ?? existing.username,
          firstName: payload.firstName ?? existing.firstName
        },
        isNew: false
      };
    }

    const participant: ContestParticipantRecord = {
      contestId: payload.contestId,
      userId: payload.userId,
      username: payload.username,
      firstName: payload.firstName,
      joinedAt: new Date().toISOString()
    };

    this.db
      .prepare(`
        INSERT INTO contest_participants (contest_id, user_id, username, first_name, joined_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(
        participant.contestId,
        participant.userId,
        participant.username ?? null,
        participant.firstName ?? null,
        participant.joinedAt
      );

    return { participant, isNew: true };
  }

  async getReferralByInvitedUserId(
    contestId: string,
    invitedUserId: number
  ): Promise<ReferralRecord | undefined> {
    const row = this.db
      .prepare(`
        SELECT
          id,
          contest_id,
          inviter_user_id,
          invited_user_id,
          invited_username,
          invited_first_name,
          start_payload,
          status,
          created_at,
          confirmed_at
        FROM referrals
        WHERE contest_id = ? AND invited_user_id = ?
      `)
      .get(contestId, invitedUserId) as ReferralRow | undefined;

    return rowToReferral(row);
  }

  async createReferralIfFirstSeen(
    payload: CreateReferralPayload
  ): Promise<ReferralRecord | undefined> {
    const existing = await this.getReferralByInvitedUserId(payload.contestId, payload.invitedUserId);
    if (existing) {
      return existing;
    }

    const referral: ReferralRecord = {
      id: crypto.randomUUID(),
      contestId: payload.contestId,
      inviterUserId: payload.inviterUserId,
      invitedUserId: payload.invitedUserId,
      invitedUsername: payload.invitedUsername,
      invitedFirstName: payload.invitedFirstName,
      startPayload: payload.startPayload,
      status: "pending",
      createdAt: new Date().toISOString()
    };

    this.db
      .prepare(`
        INSERT INTO referrals (
          id,
          contest_id,
          inviter_user_id,
          invited_user_id,
          invited_username,
          invited_first_name,
          start_payload,
          status,
          created_at,
          confirmed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        referral.id,
        referral.contestId,
        referral.inviterUserId,
        referral.invitedUserId,
        referral.invitedUsername ?? null,
        referral.invitedFirstName ?? null,
        referral.startPayload ?? null,
        referral.status,
        referral.createdAt,
        null
      );

    return referral;
  }

  async confirmReferral(contestId: string, invitedUserId: number): Promise<ReferralRecord | undefined> {
    const confirmedAt = new Date().toISOString();

    this.db
      .prepare(`
        UPDATE referrals
        SET status = 'confirmed',
            confirmed_at = COALESCE(confirmed_at, ?)
        WHERE contest_id = ? AND invited_user_id = ?
      `)
      .run(confirmedAt, contestId, invitedUserId);

    return this.getReferralByInvitedUserId(contestId, invitedUserId);
  }

  async getConfirmedReferralCount(contestId: string, inviterUserId: number): Promise<number> {
    const row = this.db
      .prepare(`
        SELECT COUNT(*) AS tickets
        FROM referrals
        WHERE contest_id = ?
          AND inviter_user_id = ?
          AND status = 'confirmed'
      `)
      .get(contestId, inviterUserId) as { tickets: number | null } | undefined;

    return Number(row?.tickets ?? 0);
  }

  async getContestTicketEntries(contestId: string): Promise<ContestTicketEntry[]> {
    const rows = this.db
      .prepare(`
        SELECT
          p.user_id,
          p.username,
          p.first_name,
          COUNT(r.id) AS tickets
        FROM contest_participants p
        LEFT JOIN referrals r
          ON r.contest_id = p.contest_id
         AND r.inviter_user_id = p.user_id
         AND r.status = 'confirmed'
        WHERE p.contest_id = ?
        GROUP BY p.user_id, p.username, p.first_name
        HAVING COUNT(r.id) > 0
        ORDER BY COUNT(r.id) DESC, p.user_id ASC
      `)
      .all(contestId) as ContestTicketRow[];

    return rows.map(rowToTicketEntry);
  }
}

const backend: ContestStorageBackend = config.databaseUrl
  ? new PostgresContestStorage()
  : new SqliteContestStorage(config.sqlitePath);

let schemaReadyPromise: Promise<void> | undefined;

function ensureSchemaReady(): Promise<void> {
  if (!schemaReadyPromise) {
    schemaReadyPromise = backend.initialize();
  }

  return schemaReadyPromise;
}

export async function getActiveContest(): Promise<ContestRecord | undefined> {
  await ensureSchemaReady();
  return backend.getActiveContest();
}

export async function createContest(winnerCount: number): Promise<ContestRecord> {
  await ensureSchemaReady();
  return backend.createContest(winnerCount);
}

export async function finishContest(contestId: string): Promise<ContestRecord | undefined> {
  await ensureSchemaReady();
  return backend.finishContest(contestId);
}

export async function registerContestParticipant(
  payload: RegisterParticipantPayload
): Promise<RegisterParticipantResult> {
  await ensureSchemaReady();
  return backend.registerContestParticipant(payload);
}

export async function getReferralByInvitedUserId(
  contestId: string,
  invitedUserId: number
): Promise<ReferralRecord | undefined> {
  await ensureSchemaReady();
  return backend.getReferralByInvitedUserId(contestId, invitedUserId);
}

export async function createReferralIfFirstSeen(
  payload: CreateReferralPayload
): Promise<ReferralRecord | undefined> {
  await ensureSchemaReady();
  return backend.createReferralIfFirstSeen(payload);
}

export async function confirmReferral(
  contestId: string,
  invitedUserId: number
): Promise<ReferralRecord | undefined> {
  await ensureSchemaReady();
  return backend.confirmReferral(contestId, invitedUserId);
}

export async function getConfirmedReferralCount(
  contestId: string,
  inviterUserId: number
): Promise<number> {
  await ensureSchemaReady();
  return backend.getConfirmedReferralCount(contestId, inviterUserId);
}

export async function getContestTicketEntries(contestId: string): Promise<ContestTicketEntry[]> {
  await ensureSchemaReady();
  return backend.getContestTicketEntries(contestId);
}
