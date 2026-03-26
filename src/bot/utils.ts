import type { Context } from "telegraf";
import { config } from "../config/index.js";
import type { ExtractedSubmissionContent } from "./types.js";

export function isTelegramErrorWithDescription(error: unknown, descriptionPart: string): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybeResponse = (error as { response?: { description?: unknown } }).response;
  return typeof maybeResponse?.description === "string" && maybeResponse.description.includes(descriptionPart);
}

export function isMessageNotModifiedError(error: unknown): boolean {
  return isTelegramErrorWithDescription(error, "message is not modified");
}

export function isAdmin(userId: number | undefined): boolean {
  if (!userId) {
    return false;
  }

  if (config.adminUserIds.size === 0) {
    return true;
  }

  return config.adminUserIds.has(userId);
}

export function isModerationChat(chatId: number): boolean {
  return chatId === config.moderationChatId;
}

export function extractSubmissionContent(ctx: Context): ExtractedSubmissionContent | undefined {
  if (!("message" in ctx.update) || !ctx.message) {
    return undefined;
  }

  if ("photo" in ctx.message && Array.isArray(ctx.message.photo) && ctx.message.photo.length > 0) {
    const largestPhoto = ctx.message.photo[ctx.message.photo.length - 1];
    const caption = typeof ctx.message.caption === "string" ? ctx.message.caption.trim() : "";

    return {
      contentType: "photo",
      text: caption,
      photoFileId: largestPhoto.file_id
    };
  }

  if ("video" in ctx.message && ctx.message.video) {
    const caption = typeof ctx.message.caption === "string" ? ctx.message.caption.trim() : "";

    return {
      contentType: "video",
      text: caption,
      videoFileId: ctx.message.video.file_id
    };
  }

  if ("text" in ctx.message && typeof ctx.message.text === "string") {
    return {
      contentType: "text",
      text: ctx.message.text
    };
  }

  return undefined;
}
