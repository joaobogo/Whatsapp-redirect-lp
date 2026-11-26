import { GLOBAL_RULES, TOOL_GUIDE } from './rules';
import type { BotSettings } from './types';

export interface PromptContext {
  settings: BotSettings;
  /** Applicant profile as text, only for bots that use it. */
  profile?: string;
  worker?: string;
  today?: string;
  caps?: Record<string, number | string>;
}

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((entry) => String(entry)).join(', ');
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}

/**
 * Simple {{settings.key}} replacement. Arrays are joined with ", ".
 * Unknown placeholders render as an empty string so a typo in a template
 * never leaks "{{...}}" into a prompt.
 */
export function renderTemplate(template: string, context: PromptContext): string {
  return template.replace(PLACEHOLDER, (_match, path: string) => {
    const [scope, key] = path.split('.', 2);
    if (scope === 'settings' && key) return formatValue(context.settings[key]);
    if (scope === 'caps' && key) return formatValue(context.caps?.[key]);
    if (scope === 'profile' && !key) return context.profile ?? '(no applicant profile loaded)';
    if (scope === 'worker' && !key) return context.worker ?? '';
    if (scope === 'today' && !key) return context.today ?? '';
    return '';
  });
}

/** Lists the placeholders a template uses, for the Advanced prompt editor. */
export function templatePlaceholders(template: string): string[] {
  const found = new Set<string>();
  for (const match of template.matchAll(PLACEHOLDER)) found.add(match[1]!);
  return [...found];
}

/** System prompt = GLOBAL RULES + rendered bot prompt + tool guide (spec section 7). */
export function buildSystemPrompt(template: string, context: PromptContext): string {
  const header = [
    context.today ? `Today is ${context.today} (America/Sao_Paulo).` : '',
    context.worker ? `You are running on the computer "${context.worker}".` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return [GLOBAL_RULES, header, renderTemplate(template, context), TOOL_GUIDE]
    .filter((part) => part.trim().length > 0)
    .join('\n\n');
}
