import type { ItemRow } from '@fgv/shared';

const COLUMNS: { header: string; value: (item: ItemRow) => string | number | null }[] = [
  { header: 'Type', value: (item) => item.kind },
  { header: 'Status', value: (item) => item.status },
  { header: 'Title', value: (item) => item.title },
  { header: 'Company', value: (item) => item.company },
  { header: 'Person', value: (item) => item.person },
  { header: 'Location', value: (item) => item.location },
  { header: 'Pay', value: (item) => item.pay },
  { header: 'Fit score', value: (item) => item.score },
  { header: 'Why it fits', value: (item) => item.fit_reason },
  { header: 'Link', value: (item) => item.url },
  { header: 'Draft', value: (item) => item.draft },
  { header: 'Notes', value: (item) => item.notes },
  { header: 'Found', value: (item) => item.created_at },
  { header: 'Sent or applied', value: (item) => item.acted_at },
];

/**
 * One CSV cell. Quotes when needed, and neutralises cells that a spreadsheet
 * would run as a formula (=, +, -, @): the text comes from web pages a bot read.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function itemsToCsv(items: ItemRow[]): string {
  const lines = [COLUMNS.map((column) => csvCell(column.header)).join(',')];
  for (const item of items) {
    lines.push(COLUMNS.map((column) => csvCell(column.value(item))).join(','));
  }
  // the BOM makes Excel read accents correctly
  return `﻿${lines.join('\r\n')}\r\n`;
}
