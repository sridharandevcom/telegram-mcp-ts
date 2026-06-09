/**
 * Message formatting — turn gramjs Message objects into compact, AI-friendly
 * plain objects. Used by get_messages, search_messages, etc.
 */

import { displayName } from "./entities.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyMessage = any;

export interface ReactionView {
  reaction: string;
  count: number;
}

export interface ForwardView {
  date: string | null;
  fromName: string | null;
  fromId: string | null;
}

export interface PollOptionView {
  text: string;
  voters: number;
  /** True if the authenticated account chose this option. */
  chosen: boolean;
}

export interface PollView {
  question: string;
  closed: boolean;
  /** Anonymous polls never expose individual voters — only these aggregate counts. */
  anonymous: boolean;
  multipleChoice: boolean;
  quiz: boolean;
  totalVoters: number | null;
  options: PollOptionView[];
}

export interface MessageView {
  id: number;
  date: string | null;
  /** true if sent by the authenticated account. */
  outgoing: boolean;
  senderId: string | null;
  senderName: string | null;
  text: string;
  /** Media kind (e.g. "Photo", "Document") or null when text-only. */
  media: string | null;
  replyToMsgId: number | null;
  editDate: string | null;
  views: number | null;
  /** Emoji reactions and their counts (empty if none). */
  reactions: ReactionView[];
  /** Forward origin if this message was forwarded, else null. */
  forwardedFrom: ForwardView | null;
  pinned: boolean;
  /** Poll data + aggregate vote counts when the message is a poll, else null. */
  poll: PollView | null;
}

/** Unix seconds -> ISO string (or null). */
export function toIso(unixSeconds?: number | null): string | null {
  if (!unixSeconds) return null;
  return new Date(unixSeconds * 1000).toISOString();
}

/** Strip the "MessageMedia" prefix to a short media label. */
export function mediaLabel(media: AnyMessage): string | null {
  if (!media) return null;
  const cn: string = media.className ?? "";
  const label = cn.replace(/^MessageMedia/, "");
  return label.length > 0 ? label : null;
}

/** Truncate long text for previews. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

/**
 * Convert a gramjs message into a MessageView using only data already attached
 * to the message (no extra network calls), so formatting a page of messages
 * stays cheap.
 */
/** Extract emoji reactions + counts from a message (best-effort). */
function extractReactions(msg: AnyMessage): ReactionView[] {
  const results = msg?.reactions?.results;
  if (!Array.isArray(results)) return [];
  return results
    .map((r: AnyMessage) => ({
      reaction: r?.reaction?.emoticon ?? (r?.reaction?.documentId ? "[custom]" : "[?]"),
      count: typeof r?.count === "number" ? r.count : 0,
    }))
    .filter((r: ReactionView) => r.count > 0);
}

/** Telegram poll option bytes -> a stable key for matching answers to results. */
function optionKey(option: unknown): string {
  if (!option) return "";
  try {
    return Buffer.from(option as Uint8Array).toString("base64");
  } catch {
    return String(option);
  }
}

/** gramjs poll question/answer text may be a string or a {text} object. */
function pollText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "text" in value) {
    return String((value as { text?: unknown }).text ?? "");
  }
  return "";
}

/**
 * Extract poll question, options, and aggregate vote counts from a
 * MessageMediaPoll. The counts are already present on the message Telegram
 * returned — no extra network call. Returns null for non-poll media.
 */
function extractPoll(media: AnyMessage): PollView | null {
  const poll = media?.poll;
  if (!poll) return null;

  const results = media?.results;
  const byOption = new Map<string, { voters: number; chosen: boolean }>();
  if (Array.isArray(results?.results)) {
    for (const r of results.results) {
      byOption.set(optionKey(r?.option), {
        voters: typeof r?.voters === "number" ? r.voters : 0,
        chosen: Boolean(r?.chosen),
      });
    }
  }

  const options: PollOptionView[] = (poll.answers ?? []).map((a: AnyMessage) => {
    const v = byOption.get(optionKey(a?.option));
    return { text: pollText(a?.text), voters: v?.voters ?? 0, chosen: v?.chosen ?? false };
  });

  return {
    question: pollText(poll.question),
    closed: Boolean(poll.closed),
    anonymous: !poll.publicVoters,
    multipleChoice: Boolean(poll.multipleChoice),
    quiz: Boolean(poll.quiz),
    totalVoters: typeof results?.totalVoters === "number" ? results.totalVoters : null,
    options,
  };
}

/** Extract forward origin from a message (best-effort). */
function extractForward(msg: AnyMessage): ForwardView | null {
  const fwd = msg?.fwdFrom;
  if (!fwd) return null;
  const fromId = fwd.fromId?.userId ?? fwd.fromId?.channelId ?? fwd.fromId?.chatId;
  return {
    date: toIso(fwd.date),
    fromName: fwd.fromName ?? null,
    fromId: fromId ? fromId.toString() : null,
  };
}

export function messageToView(msg: AnyMessage): MessageView {
  const sender = msg?.sender;
  const replyToMsgId: number | null =
    msg?.replyToMsgId ?? msg?.replyTo?.replyToMsgId ?? null;

  return {
    id: msg?.id ?? 0,
    date: toIso(msg?.date),
    outgoing: Boolean(msg?.out),
    senderId: msg?.senderId ? msg.senderId.toString() : null,
    senderName: sender ? displayName(sender) : null,
    text: msg?.message ?? "",
    media: msg?.media ? mediaLabel(msg.media) : null,
    replyToMsgId,
    editDate: toIso(msg?.editDate),
    views: typeof msg?.views === "number" ? msg.views : null,
    reactions: extractReactions(msg),
    forwardedFrom: extractForward(msg),
    pinned: Boolean(msg?.pinned),
    poll: msg?.media ? extractPoll(msg.media) : null,
  };
}
