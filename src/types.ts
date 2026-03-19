export type ModerationStatus = "pending" | "approved" | "rejected";

export interface SubmissionRecord {
  id: string;
  userId: number;
  username?: string;
  firstName?: string;
  text: string;
  createdAt: string;
  status: ModerationStatus;
  moderationMessageId?: number;
  publishedMessageId?: number;
  rejectionReason?: string;
  moderatedByUserId?: number;
  moderatedByUsername?: string;
  moderatedByFirstName?: string;
  moderatedAt?: string;
}

export interface FilterResult {
  allowed: boolean;
  reasons: string[];
}
