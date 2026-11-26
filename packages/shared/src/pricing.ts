/**
 * Price table used to show "cost so far" while a run is in progress.
 * USD per million tokens, Anthropic first-party list prices at the time of
 * writing (verified 2026-11-26). Update here when prices change; the final
 * cost of a run comes from the Agent SDK's own total when it reports one.
 */
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export const MODEL_PRICES: Record<string, ModelPrice> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};

/** Used for a model that is not in the table, so cost is over- rather than under-estimated. */
export const FALLBACK_PRICE: ModelPrice = {
  input: 5,
  output: 25,
  cacheRead: 0.5,
  cacheWrite: 6.25,
};

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export function priceFor(model: string): ModelPrice {
  if (MODEL_PRICES[model]) return MODEL_PRICES[model];
  const known = Object.keys(MODEL_PRICES).find((name) => model.startsWith(name));
  return known ? MODEL_PRICES[known]! : FALLBACK_PRICE;
}

export function costUsd(model: string, usage: TokenUsage): number {
  const price = priceFor(model);
  const total =
    usage.inputTokens * price.input +
    usage.outputTokens * price.output +
    (usage.cacheReadTokens ?? 0) * price.cacheRead +
    (usage.cacheWriteTokens ?? 0) * price.cacheWrite;
  return Math.round((total / 1_000_000) * 10_000) / 10_000;
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: (a.cacheReadTokens ?? 0) + (b.cacheReadTokens ?? 0),
    cacheWriteTokens: (a.cacheWriteTokens ?? 0) + (b.cacheWriteTokens ?? 0),
  };
}

export function formatUsd(value: number | null | undefined): string {
  const amount = Number(value ?? 0);
  return `$${amount.toFixed(amount > 0 && amount < 1 ? 3 : 2)}`;
}
