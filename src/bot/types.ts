export type ExtractedSubmissionContent =
  | {
      contentType: "text";
      text: string;
    }
  | {
      contentType: "photo";
      text: string;
      photoFileId: string;
    }
  | {
      contentType: "video";
      text: string;
      videoFileId: string;
    };

export type PendingMediaDraft = {
  contentType: "photo" | "video";
  photoFileId?: string;
  videoFileId?: string;
  createdAt: number;
};

export type PendingRejectionNote = {
  submissionId: string;
  promptMessageId: number;
};
