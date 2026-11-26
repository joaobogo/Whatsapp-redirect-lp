/**
 * Logging for the worker. Everything written to the console, to pm2 log files
 * or to run_events goes through redact(): logs never contain keys, cookies,
 * passwords or whole pages (spec section 13).
 */

const SECRET_PATTERNS: [RegExp, string][] = [
  [/sk-ant-[A-Za-z0-9_-]{8,}/g, '[anthropic key]'],
  [/sb_(?:secret|publishable)_[A-Za-z0-9_-]{8,}/g, '[supabase key]'],
  // JSON web tokens (legacy Supabase keys, session tokens)
  [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}/g, '[token]'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[private key]'],
  [/\b(authorization|cookie|set-cookie)\s*[:=]\s*[^\n]+/gi, '$1: [hidden]'],
  [
    /\b(pass(?:word)?|passcode|senha|secret|token|api[_-]?key|li_at|jsessionid)(["']?\s*[:=]\s*["']?)[^\s"',;&]+/gi,
    '$1$2[hidden]',
  ],
];

export function redact(input: string): string {
  let output = input;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    output = output.replace(pattern, replacement);
  }
  return output;
}

/** Shortens text for a log line and collapses whitespace. */
export function clip(input: string, max: number): string {
  const text = input.replace(/\s+/g, ' ').trim();
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 3))}...`;
}

/** Keeps line breaks (for summaries and assistant text), only trims the length. */
export function trimTo(input: string, max: number): string {
  const text = input.trim();
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 3))}...`;
}

function stamp(): string {
  return new Date().toISOString();
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return 'unknown error';
}

export const logger = {
  info(message: string): void {
    console.log(`${stamp()} ${redact(message)}`);
  },
  warn(message: string): void {
    console.warn(`${stamp()} WARN ${redact(message)}`);
  },
  error(message: string, error?: unknown): void {
    const detail = error === undefined ? '' : `: ${describe(error)}`;
    console.error(`${stamp()} ERROR ${redact(message + detail)}`);
  },
};

export function errorMessage(error: unknown): string {
  return redact(describe(error));
}

const TOOL_INPUT_KEYS = [
  'url',
  'query',
  'action',
  'element',
  'target',
  'key',
  'text',
  'values',
  'time',
  'kind',
  'title',
  'company',
  'person',
  'status',
  'id',
  'lock',
  'message',
  'limit',
];

/** A short, secret-free description of a tool call for the live log. */
export function summarizeToolInput(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object') return {};
  const record = input as Record<string, unknown>;
  const summary: Record<string, string> = {};
  for (const key of TOOL_INPUT_KEYS) {
    const value = record[key];
    if (value === undefined || value === null) continue;
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    summary[key] = redact(clip(text, 160));
  }
  if (Array.isArray(record.fields)) summary.fields = `${record.fields.length} form fields`;
  if (Array.isArray(record.paths)) summary.paths = `${record.paths.length} file(s)`;
  return summary;
}

export function toolLabel(name: string): string {
  return name.replace(/^mcp__(dashboard|playwright)__/, '');
}
