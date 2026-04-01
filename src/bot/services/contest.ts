import type { Context } from "telegraf";
import { config } from "../../config/index.js";

function extractStartText(ctx: Context): string | undefined {
  if (!("message" in ctx.update) || !ctx.message || !("text" in ctx.message)) {
    return undefined;
  }

  return typeof ctx.message.text === "string" ? ctx.message.text.trim() : undefined;
}

export function extractStartPayload(ctx: Context): string | undefined {
  const text = extractStartText(ctx);

  if (!text) {
    return undefined;
  }

  const match = text.match(/^\/start(?:@\w+)?(?:\s+(.+))?$/);
  const payload = match?.[1]?.trim();
  return payload || undefined;
}

export function parseInviterUserId(payload: string | undefined): number | undefined {
  if (!payload || !payload.startsWith("ref_")) {
    return undefined;
  }

  const rawInviterId = payload.slice(4).trim();
  const inviterId = Number(rawInviterId);

  if (!Number.isInteger(inviterId) || inviterId <= 0) {
    return undefined;
  }

  return inviterId;
}

export async function isContestChannelMember(ctx: Context, userId: number): Promise<boolean> {
  const member = await ctx.telegram.getChatMember(config.contestChannelId, userId);
  return !["left", "kicked"].includes(member.status);
}

export async function getBotUsername(ctx: Context): Promise<string> {
  if (ctx.botInfo?.username) {
    return ctx.botInfo.username;
  }

  const me = await ctx.telegram.getMe();
  return me.username;
}

export async function buildReferralLink(ctx: Context, userId: number): Promise<string> {
  const username = await getBotUsername(ctx);
  return `https://t.me/${username}?start=ref_${userId}`;
}

export function formatContestUserLabel(userId: number, username?: string, firstName?: string): string {
  if (username) {
    return `@${username}`;
  }

  if (firstName) {
    return `${firstName} (ID: ${userId})`;
  }

  return `ID: ${userId}`;
}
