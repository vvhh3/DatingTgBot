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
}

export interface FilterResult {
  allowed: boolean;
  reasons: string[];
}
