import { APP_TIME_ZONE } from './types';

/** Parts of a date as seen on a wall clock in the given time zone. */
function zonedParts(date: Date, timeZone: string): Record<string, number> {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return parts;
}

/** The instant at which "today" began in the app time zone. Daily caps count from here. */
export function startOfDay(now: Date = new Date(), timeZone: string = APP_TIME_ZONE): Date {
  const parts = zonedParts(now, timeZone);
  const elapsedMs =
    ((parts.hour ?? 0) * 3600 + (parts.minute ?? 0) * 60 + (parts.second ?? 0)) * 1000 +
    now.getMilliseconds();
  return new Date(now.getTime() - elapsedMs);
}

/** "Thursday, 26 November 2026" in the app time zone, for prompts. */
export function todayLabel(now: Date = new Date(), timeZone: string = APP_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(now);
}

export function timeAgo(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return 'never';
  const seconds = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000));
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} d ago`;
}

export function formatDuration(
  startIso: string | null,
  endIso: string | null,
  now = new Date(),
): string {
  if (!startIso) return '-';
  const end = endIso ? new Date(endIso) : now;
  const seconds = Math.max(0, Math.round((end.getTime() - new Date(startIso).getTime()) / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return minutes > 0 ? `${minutes}m ${rest}s` : `${rest}s`;
}

/** A worker counts as offline when it has not sent a heartbeat for 90 seconds (spec 6.7). */
export const WORKER_OFFLINE_AFTER_SECONDS = 90;

export function isWorkerOnline(lastHeartbeat: string | null, now: Date = new Date()): boolean {
  if (!lastHeartbeat) return false;
  return now.getTime() - new Date(lastHeartbeat).getTime() <= WORKER_OFFLINE_AFTER_SECONDS * 1000;
}
