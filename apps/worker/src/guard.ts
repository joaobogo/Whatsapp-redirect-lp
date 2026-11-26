import path from 'node:path';

/**
 * Tool-level enforcement of the starred safety rules (spec section 9).
 *
 * Every tool call a bot makes passes through `ToolGuard.check()` before it
 * runs (wired as a PreToolUse hook in runner.ts). The prompt also states the
 * rules, but this file is what actually stops a call: a bot that is tricked by
 * a web page still cannot type a password, open a checkout page, accept a
 * consent banner or use a tool that is not on its list.
 *
 * Do not relax a pattern here without John's say-so. Blocking too much only
 * costs a "needs_human" item; blocking too little can cost money or an account.
 */

export type GuardDecision = { allow: true } | { allow: false; reason: string };

const ALLOW: GuardDecision = { allow: true };
const deny = (reason: string): GuardDecision => ({ allow: false, reason });

/** Rule 1: fields a bot must never type into. */
export const SENSITIVE_FIELD =
  /pass\s?word|passcode|pass\s?phrase|\bsenha\b|contrase[nñ]a|\botp\b|one[- ]time|verification code|security code|auth(?:entication)? code|\d+[- ]?digit code|confirmation code|(?:login|sign[- ]in|access|sms|email(?:ed)?) code|code (?:we |was )?sent|c[oó]digo de (?:verifica|seguran)|\b2fa\b|two[- ]factor|\bcvv\b|\bcvc\b|card number|credit card|debit card|cart[aã]o de cr[eé]dito|n[uú]mero do cart[aã]o|\bcnpj\b|\bcpf\b|\bssn\b|social security|tax id|tax number|national id|passport number|bank account|\biban\b|routing number|\bpin\b|type\s*=\s*["']?password/i;

/** Rule 2: pages that take money. Pattern from the spec, used on browser navigation. */
export const PAYMENT_URL = /checkout|payment|billing|\/pay|stripe\.com|paypal\.com/i;

/** Rule 4: consent the bot must never give for anyone. */
export const CONSENT_CLICK =
  /accept all cookies|accept all|accept (?:the )?terms|i agree|agree (?:to|and)|i accept|aceitar (?:todos|tudo|os termos)|concordo|aceptar (?:todo|todas|los t[eé]rminos)/i;

/** Rule 2: buttons that spend money. */
export const PAYMENT_CLICK =
  /\bpay now\b|\bbuy now\b|\bpurchase\b|place (?:your )?order|\bsubscribe\b|start (?:my |your )?(?:free )?trial|add (?:a )?(?:payment|card)|upgrade (?:now|plan|to )|buy (?:connects|credits)|\bcomprar\b|\bassinar\b/i;

/** Rule 3: bot-detection challenges. */
export const CAPTCHA_CLICK =
  /captcha|i['’]?m not a robot|not a robot|verify (?:that )?you(?: are|['’]re) (?:a )?human|are you human|sou humano/i;

const PLAYWRIGHT_PREFIX = 'mcp__playwright__';

/** The only browser tools a bot gets. Anything that runs script or edits cookies is left out. */
export const ALLOWED_BROWSER_TOOLS: readonly string[] = [
  'browser_navigate',
  'browser_navigate_back',
  'browser_snapshot',
  'browser_find',
  'browser_click',
  'browser_type',
  'browser_fill_form',
  'browser_select_option',
  'browser_press_key',
  'browser_hover',
  'browser_wait_for',
  'browser_tabs',
  'browser_file_upload',
  'browser_handle_dialog',
  'browser_close',
].map((name) => PLAYWRIGHT_PREFIX + name);

/** Validates the two check digits of a Brazilian company tax number. */
export function isValidCnpj(digits: string): boolean {
  if (!/^\d{14}$/.test(digits) || /^(\d)\1{13}$/.test(digits)) return false;
  const check = (length: number): number => {
    const weights =
      length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((total, weight, index) => total + Number(digits[index]) * weight, 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return check(12) === Number(digits[12]) && check(13) === Number(digits[13]);
}

/** True when the text carries a real CNPJ, formatted or not. Rule 1: it is never typed anywhere. */
export function containsCnpj(text: string): boolean {
  const matches = text.match(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g) ?? [];
  return matches.some((match) => isValidCnpj(match.replace(/\D/g, '')));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Pulls the readable text out of whatever shape a tool result has. */
export function toolResultText(response: unknown): string {
  if (typeof response === 'string') return response;
  if (Array.isArray(response)) return response.map(toolResultText).join('\n');
  const record = asRecord(response);
  if (typeof record.text === 'string') return record.text;
  if (record.content !== undefined) return toolResultText(record.content);
  return '';
}

/** `- textbox "Password" [ref=e12]` -> ["e12", 'textbox "Password"'] */
export function parseSnapshotRefs(snapshot: string): Map<string, string> {
  const refs = new Map<string, string>();
  for (const line of snapshot.split('\n')) {
    const match = /\[ref=([^\]\s]+)\]/.exec(line);
    if (!match) continue;
    const label = line
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/^\s*-\s*/, '')
      .replace(/\s+/g, ' ')
      .trim();
    refs.set(match[1]!, label);
  }
  return refs;
}

export interface ToolGuardOptions {
  /** Exact tool names this run may use. Everything else is refused. */
  allowedTools: readonly string[];
  /** The only folder files may be uploaded from (the applicant's CV and photo). */
  uploadDir: string | null;
}

export class ToolGuard {
  private readonly allowed: Set<string>;
  private readonly uploadDir: string | null;
  private labels = new Map<string, string>();
  private focusIsSensitive = false;

  constructor(options: ToolGuardOptions) {
    this.allowed = new Set(options.allowedTools);
    this.uploadDir = options.uploadDir ? path.resolve(options.uploadDir) : null;
  }

  /** Remember what the page looks like, so refs can be checked against real labels. */
  noteToolResult(toolName: string, response: unknown): void {
    if (!toolName.startsWith(PLAYWRIGHT_PREFIX)) return;
    const refs = parseSnapshotRefs(toolResultText(response));
    if (refs.size > 0) this.labels = refs;
  }

  /** What we know about the element a call is aimed at: its description, its ref and its real label. */
  private describe(input: Record<string, unknown>): string {
    const target = text(input.target) || text(input.ref);
    return [text(input.element), target, this.labels.get(target) ?? '', text(input.name)]
      .filter(Boolean)
      .join(' | ');
  }

  check(toolName: string, rawInput: unknown): GuardDecision {
    if (!this.allowed.has(toolName)) {
      return deny(`The tool ${toolName} is not available to this bot.`);
    }
    if (!toolName.startsWith(PLAYWRIGHT_PREFIX)) return ALLOW;

    const input = asRecord(rawInput);
    const tool = toolName.slice(PLAYWRIGHT_PREFIX.length);

    switch (tool) {
      case 'browser_navigate':
        this.focusIsSensitive = false;
        return this.checkUrl(text(input.url));

      case 'browser_tabs':
        this.focusIsSensitive = false;
        return input.url ? this.checkUrl(text(input.url)) : ALLOW;

      case 'browser_click': {
        const what = this.describe(input);
        if (CONSENT_CLICK.test(what)) {
          return deny(
            'Rule 4: never accept terms, agreements or consent banners. Leave it, or choose "reject non-essential" if the page cannot be used otherwise.',
          );
        }
        if (PAYMENT_CLICK.test(what)) {
          return deny(
            'Rule 2: never pay, buy, subscribe or start a trial. Mark the item needs_human with the price.',
          );
        }
        if (CAPTCHA_CLICK.test(what)) {
          return deny(
            'Rule 3: never solve or work around a CAPTCHA or bot check. Mark the item needs_human.',
          );
        }
        this.focusIsSensitive = SENSITIVE_FIELD.test(what);
        return ALLOW;
      }

      case 'browser_type':
        return this.checkTyping(this.describe(input), text(input.text));

      case 'browser_select_option':
        return this.checkTyping(this.describe(input), '');

      case 'browser_fill_form': {
        const fields = Array.isArray(input.fields) ? input.fields : [];
        for (const field of fields) {
          const record = asRecord(field);
          const what = `${this.describe(record)} | type=${text(record.type)}`;
          const decision = this.checkTyping(what, text(record.value));
          if (!decision.allow) return decision;
        }
        return ALLOW;
      }

      case 'browser_press_key': {
        const key = text(input.key);
        // typing a secret one key at a time into a focused password field
        if (this.focusIsSensitive && key.length === 1) {
          return deny(
            'Rule 1: never type into a password, code or card field. Mark the item needs_human.',
          );
        }
        return ALLOW;
      }

      case 'browser_file_upload': {
        const paths = Array.isArray(input.paths) ? input.paths : [];
        for (const entry of paths) {
          if (!this.isInsideUploadDir(text(entry))) {
            return deny('Only the CV and photo from the worker assets folder can be uploaded.');
          }
        }
        return ALLOW;
      }

      default:
        return ALLOW;
    }
  }

  private checkUrl(url: string): GuardDecision {
    if (!url) return ALLOW;
    if (!/^https?:\/\//i.test(url)) {
      return deny('Only http and https pages can be opened.');
    }
    if (PAYMENT_URL.test(url)) {
      return deny(
        'Rule 2: this looks like a checkout, payment or billing page. Do not open it. Mark the item needs_human with the price.',
      );
    }
    return ALLOW;
  }

  private checkTyping(what: string, value: string): GuardDecision {
    if (SENSITIVE_FIELD.test(what)) {
      return deny(
        'Rule 1: never type passwords, codes, card numbers, bank or government ID numbers. Mark the item needs_human with the exact request.',
      );
    }
    if (value && containsCnpj(value)) {
      return deny(
        'Rule 1: the company tax number (CNPJ) is never typed into any form. Mark the item needs_human.',
      );
    }
    return ALLOW;
  }

  private isInsideUploadDir(file: string): boolean {
    if (!this.uploadDir || !file) return false;
    const resolved = path.resolve(file);
    const relative = path.relative(this.uploadDir, resolved);
    return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
  }
}
