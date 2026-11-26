import { capabilitiesFor } from './bots/catalog';
import { HARD_LIMITS } from './rules';
import type { ApprovalMode, ItemKind, ItemStatus } from './types';

export interface DedupeInput {
  kind: ItemKind;
  url?: string | null;
  company?: string | null;
  title?: string | null;
  person?: string | null;
}

/** lower(url), or kind|company|title|person when there is no URL (spec section 5). */
export function dedupeKey(input: DedupeInput): string {
  const url = input.url?.trim();
  if (url) return normalizeUrl(url);
  return [input.kind, input.company, input.title, input.person]
    .map((part) => (part ?? '').trim().toLowerCase().replace(/\s+/g, ' '))
    .join('|');
}

const TRACKING_PARAMS =
  /^(utm_[a-z]+|gclid|fbclid|mc_[a-z]+|ref|refid|trk|trackingid|source|src)$/i;

/** Lower-cases a URL and drops tracking noise so the same posting is not saved twice. */
export function normalizeUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.hash = '';
    for (const name of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(name)) url.searchParams.delete(name);
    }
    const query = url.searchParams.toString();
    const path = url.pathname.replace(/\/+$/, '');
    return `${url.protocol}//${url.host}${path}${query ? `?${query}` : ''}`.toLowerCase();
  } catch {
    return raw.trim().toLowerCase();
  }
}

/** Statuses a bot may never set when it saves an item. Those belong to people or to update_item. */
const NEVER_ON_SAVE: readonly ItemStatus[] = ['approved', 'sent', 'applied'];

/**
 * Limits the status a bot asks for when saving, by approval mode (section 9):
 *  - nothing is ever saved as approved / sent / applied;
 *  - draft-only bots cannot queue anything for approval, so it can never reach a sender.
 */
export function limitSaveStatus(requested: ItemStatus | undefined, mode: ApprovalMode): ItemStatus {
  const status: ItemStatus = requested ?? 'found';
  if (NEVER_ON_SAVE.includes(status)) return mode === 'draft_only' ? 'found' : 'needs_approval';
  if (mode === 'draft_only' && status === 'needs_approval') return 'found';
  return status;
}

/** Statuses that must not be overwritten when the same item is found again. */
export const SETTLED_STATUSES: readonly ItemStatus[] = [
  'approved',
  'sent',
  'applied',
  'skipped',
  'needs_human',
  'closed',
];

export interface ContactCheckInput {
  botSlug: string;
  approvalMode: ApprovalMode;
  /** Status the item has now. */
  currentStatus: ItemStatus;
  /** Status the bot wants to set: 'sent' or 'applied'. */
  nextStatus: ItemStatus;
  itemUrl?: string | null;
  /** sent + applied today by this bot. */
  usedToday: number;
  dailyCap: number;
  /** LinkedIn messages sent today by every bot. */
  linkedinSentToday: number;
  /** Global setting; the hard limit of 20 still applies on top. */
  linkedinDailyCap: number;
  /** LinkedIn Easy Apply submissions today. */
  linkedinAppliedToday: number;
  /** Seconds since the last LinkedIn message, or null when none was sent today. */
  secondsSinceLastLinkedinSend: number | null;
  /** Minimum minutes between LinkedIn messages (bot setting, never below the hard limit). */
  spacingMinutes?: number;
}

export type ContactDecision = { allowed: true } | { allowed: false; reason: string };

export function isLinkedinUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'linkedin.com' || host.endsWith('.linkedin.com');
  } catch {
    return /linkedin\.com/i.test(url);
  }
}

/**
 * The gate for rules 5 and 6: may this bot mark this item 'sent' or 'applied' right now?
 * Used by the worker's update_item tool; the database trigger repeats the same checks.
 */
export function checkContactAllowed(input: ContactCheckInput): ContactDecision {
  const capabilities = capabilitiesFor(input.botSlug);
  if (input.nextStatus !== 'sent' && input.nextStatus !== 'applied') return { allowed: true };

  if (!capabilities.contactStatus || input.approvalMode === 'draft_only') {
    return { allowed: false, reason: 'This bot only drafts. It never contacts anyone.' };
  }
  if (capabilities.contactStatus !== input.nextStatus) {
    return {
      allowed: false,
      reason: `This bot may set '${capabilities.contactStatus}', not '${input.nextStatus}'.`,
    };
  }

  const autoApply =
    input.approvalMode === 'auto_within_rules' &&
    input.botSlug === 'job-apply' &&
    input.nextStatus === 'applied' &&
    input.currentStatus === 'ready';
  if (input.currentStatus !== 'approved' && !autoApply) {
    return {
      allowed: false,
      reason: `Item is '${input.currentStatus}', not 'approved'. Nothing is sent without approval.`,
    };
  }

  if (input.usedToday >= input.dailyCap) {
    return {
      allowed: false,
      reason: `Daily cap reached (${input.usedToday} of ${input.dailyCap}).`,
    };
  }

  if (input.nextStatus === 'sent') {
    const cap = Math.min(input.linkedinDailyCap, HARD_LIMITS.linkedinMessagesPerDay);
    if (input.linkedinSentToday >= cap) {
      return {
        allowed: false,
        reason: `LinkedIn daily cap reached (${input.linkedinSentToday} of ${cap} across all bots).`,
      };
    }
    const spacing = Math.max(
      input.spacingMinutes ?? HARD_LIMITS.linkedinMinSpacingMinutes,
      HARD_LIMITS.linkedinMinSpacingMinutes,
    );
    if (
      input.secondsSinceLastLinkedinSend !== null &&
      input.secondsSinceLastLinkedinSend < spacing * 60
    ) {
      const wait = Math.ceil(spacing * 60 - input.secondsSinceLastLinkedinSend);
      return {
        allowed: false,
        reason: `Too soon after the last LinkedIn message. Wait ${wait} more seconds.`,
      };
    }
  }

  if (
    input.nextStatus === 'applied' &&
    isLinkedinUrl(input.itemUrl) &&
    input.linkedinAppliedToday >= HARD_LIMITS.linkedinEasyApplyPerDay
  ) {
    return {
      allowed: false,
      reason: `LinkedIn Easy Apply limit reached (${HARD_LIMITS.linkedinEasyApplyPerDay} per day).`,
    };
  }

  return { allowed: true };
}

export interface CapStatus {
  used: number;
  cap: number;
  remaining: number;
}

export function capStatus(used: number, cap: number): CapStatus {
  return { used, cap, remaining: Math.max(0, cap - used) };
}

/** Statuses of other bots' items that a worker bot may pick up, by approval mode. */
export function workableStatuses(botSlug: string, mode: ApprovalMode): ItemStatus[] {
  if (botSlug === 'job-apply')
    return mode === 'auto_within_rules' ? ['ready', 'approved'] : ['approved'];
  return ['approved'];
}

export const ITEM_STATUS_LABELS: Record<ItemStatus, string> = {
  found: 'Found',
  ready: 'Ready',
  needs_approval: 'Waiting for approval',
  approved: 'Approved',
  sent: 'Sent',
  applied: 'Applied',
  skipped: 'Skipped',
  needs_human: 'Needs you',
  closed: 'Closed',
  error: 'Error',
};

export const ITEM_KIND_LABELS: Record<ItemKind, string> = {
  job: 'Job',
  lead: 'Lead',
  candidate: 'Candidate',
  message_draft: 'Message draft',
  proposal: 'Proposal',
  other: 'Other',
};
