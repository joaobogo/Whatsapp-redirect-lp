// Phase 9 (optional): mirror items into the Google Sheet "Sales Queue".
// Off unless GOOGLE_SERVICE_ACCOUNT_JSON and SALES_QUEUE_SHEET_ID are set.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { google } from 'googleapis';
import { ITEM_KIND_LABELS, ITEM_STATUS_LABELS, normalizeUrl, type ItemRow } from '@fgv/shared';
import { WORKER_ROOT, type WorkerConfig } from './config';
import type { Db } from './db';
import { errorMessage, logger } from './log';

const SYNC_MS = 30_000;
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

/** Columns A-L of the tab, in order. */
export const SHEET_HEADER = [
  'ID',
  'Date',
  'Channel',
  'Type',
  'Company',
  'Person',
  'Link',
  'Why it fits',
  'Draft',
  'Status',
  'Notes',
  'Last updated',
] as const;

const LINK_COLUMN = 6;
const ID_COLUMN = 0;

/** A cell that starts with =, +, - or @ would be run as a formula; make it plain text. */
function plain(value: string | null | undefined): string {
  const text = value ?? '';
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

export function itemToSheetRow(item: ItemRow, channel: string): string[] {
  return [
    item.id,
    item.created_at.slice(0, 10),
    plain(channel),
    ITEM_KIND_LABELS[item.kind],
    plain(item.company),
    plain(item.person ?? item.title),
    plain(item.url),
    plain(item.fit_reason),
    plain(item.draft),
    ITEM_STATUS_LABELS[item.status],
    plain(item.notes),
    item.updated_at,
  ];
}

export interface SheetPlan {
  /** existing rows to overwrite: 1-based row number -> values */
  updates: { row: number; values: string[] }[];
  /** new rows to add at the bottom */
  appends: string[][];
}

function linkKey(value: string | undefined): string {
  const link = (value ?? '').replace(/^'/, '').trim();
  return link ? normalizeUrl(link) : '';
}

/**
 * Decides, for each changed item, whether it overwrites an existing row or is
 * added. Rows are matched by Link (column G), then by ID (column A), so the
 * same item never appears twice.
 */
export function planSheetSync(
  existingRows: string[][],
  items: { item: ItemRow; channel: string }[],
): SheetPlan {
  const byLink = new Map<string, number>();
  const byId = new Map<string, number>();
  existingRows.forEach((row, index) => {
    const rowNumber = index + 1;
    const link = linkKey(row[LINK_COLUMN]);
    if (link && !byLink.has(link)) byLink.set(link, rowNumber);
    const id = (row[ID_COLUMN] ?? '').trim();
    if (id && !byId.has(id)) byId.set(id, rowNumber);
  });

  const plan: SheetPlan = { updates: [], appends: [] };
  const pending = new Map<string, number>();
  for (const { item, channel } of items) {
    const values = itemToSheetRow(item, channel);
    const link = linkKey(item.url ?? undefined);
    const row = (link ? byLink.get(link) : undefined) ?? byId.get(item.id);
    if (row !== undefined) {
      plan.updates.push({ row, values });
      continue;
    }
    // two changed items with the same link in one batch: keep the newer one
    const key = link || item.id;
    const earlier = pending.get(key);
    if (earlier !== undefined) plan.appends[earlier] = values;
    else {
      pending.set(key, plan.appends.length);
      plan.appends.push(values);
    }
  }
  return plan;
}

function loadCredentials(value: string): Record<string, unknown> {
  const trimmed = value.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed) as Record<string, unknown>;
  const file = path.isAbsolute(trimmed) ? trimmed : path.resolve(WORKER_ROOT, trimmed);
  if (!existsSync(file)) throw new Error('The Google service account file was not found.');
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
}

/**
 * Every 30 seconds, copies items that changed since the last pass into the
 * sheet, so a new item appears there within a minute. Runs on the scheduler
 * worker only, which makes it the single writer (no duplicate rows).
 * Returns a function that stops it, or null when the mirror is not configured.
 */
export function startSheetsMirror(db: Db, config: WorkerConfig): (() => void) | null {
  if (!config.sheets) return null;
  const { credentials, sheetId, tab } = config.sheets;
  let api: ReturnType<typeof google.sheets>;
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: loadCredentials(credentials),
      scopes: SCOPES,
    });
    api = google.sheets({ version: 'v4', auth });
  } catch (error) {
    logger.warn(`Google Sheet mirror is off: ${errorMessage(error)}`);
    return null;
  }

  const range = (cells: string) => `'${tab.replace(/'/g, "''")}'!${cells}`;
  let since = new Date(Date.now() - 10 * 60_000).toISOString();
  let busy = false;

  const sync = async () => {
    if (busy) return;
    busy = true;
    try {
      const { data: changed } = await db
        .from('items')
        .select('*')
        .gt('updated_at', since)
        .order('updated_at', { ascending: true })
        .limit(500);
      if (!changed || changed.length === 0) return;

      const { data: bots } = await db.from('bots').select('id, channel');
      const channels = new Map((bots ?? []).map((bot) => [bot.id, bot.channel]));
      const current = await api.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: range('A:L'),
      });
      const rows = (current.data.values ?? []) as string[][];
      if (rows.length === 0) {
        await api.spreadsheets.values.update({
          spreadsheetId: sheetId,
          range: range('A1:L1'),
          valueInputOption: 'RAW',
          requestBody: { values: [[...SHEET_HEADER]] },
        });
        rows.push([...SHEET_HEADER]);
      }

      const plan = planSheetSync(
        rows,
        changed.map((item) => ({ item, channel: channels.get(item.bot_id ?? '') ?? '' })),
      );
      if (plan.updates.length > 0) {
        await api.spreadsheets.values.batchUpdate({
          spreadsheetId: sheetId,
          requestBody: {
            valueInputOption: 'RAW',
            data: plan.updates.map((update) => ({
              range: range(`A${update.row}:L${update.row}`),
              values: [update.values],
            })),
          },
        });
      }
      if (plan.appends.length > 0) {
        await api.spreadsheets.values.append({
          spreadsheetId: sheetId,
          range: range('A:L'),
          valueInputOption: 'RAW',
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values: plan.appends },
        });
      }
      since = changed[changed.length - 1]!.updated_at;
    } catch (error) {
      logger.warn(`Google Sheet mirror: ${errorMessage(error)}`);
    } finally {
      busy = false;
    }
  };

  const timer = setInterval(() => void sync(), SYNC_MS);
  void sync();
  logger.info(`Google Sheet mirror is on (tab "${tab}")`);
  return () => clearInterval(timer);
}
