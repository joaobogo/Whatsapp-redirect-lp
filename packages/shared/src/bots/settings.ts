import { z } from 'zod';
import type { BotSettings, Json, SettingsValue } from '../types';

/**
 * A bot's settings are described by a list of fields. From that list we build:
 *  - a zod schema (server-side validation and defaults),
 *  - a JSON Schema stored in bots.settings_schema (so the web app can draw the
 *    form for any bot row without knowing its code), and
 *  - the click-only form controls in the web app.
 */
interface FieldBase {
  key: string;
  label: string;
  help?: string;
}

export interface TextField extends FieldBase {
  kind: 'text';
  default: string;
  required?: boolean;
  placeholder?: string;
}
export interface UrlField extends FieldBase {
  kind: 'url';
  default: string;
  required?: boolean;
  placeholder?: string;
}
export interface SelectField extends FieldBase {
  kind: 'select';
  options: string[];
  default: string;
  /** Locked fields are shown but cannot be changed (the default always wins). */
  locked?: boolean;
}
export interface MultiField extends FieldBase {
  kind: 'multi';
  options: string[];
  default: string[];
}
export interface NumberField extends FieldBase {
  kind: 'number';
  min: number;
  max: number;
  step?: number;
  default: number;
  unit?: string;
}
export interface RangeField extends FieldBase {
  kind: 'range';
  min: number;
  max: number;
  step?: number;
  default: [number, number];
  unit?: string;
}
export interface TagsField extends FieldBase {
  kind: 'tags';
  default: string[];
  placeholder?: string;
}
export interface ToggleField extends FieldBase {
  kind: 'toggle';
  default: boolean;
  locked?: boolean;
}

export type FieldSpec =
  | TextField
  | UrlField
  | SelectField
  | MultiField
  | NumberField
  | RangeField
  | TagsField
  | ToggleField;

const UI_KEY = 'x-ui';

const fieldSpecSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('text'),
    key: z.string(),
    label: z.string(),
    help: z.string().optional(),
    default: z.string(),
    required: z.boolean().optional(),
    placeholder: z.string().optional(),
  }),
  z.object({
    kind: z.literal('url'),
    key: z.string(),
    label: z.string(),
    help: z.string().optional(),
    default: z.string(),
    required: z.boolean().optional(),
    placeholder: z.string().optional(),
  }),
  z.object({
    kind: z.literal('select'),
    key: z.string(),
    label: z.string(),
    help: z.string().optional(),
    options: z.array(z.string()).min(1),
    default: z.string(),
    locked: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('multi'),
    key: z.string(),
    label: z.string(),
    help: z.string().optional(),
    options: z.array(z.string()).min(1),
    default: z.array(z.string()),
  }),
  z.object({
    kind: z.literal('number'),
    key: z.string(),
    label: z.string(),
    help: z.string().optional(),
    min: z.number(),
    max: z.number(),
    step: z.number().optional(),
    default: z.number(),
    unit: z.string().optional(),
  }),
  z.object({
    kind: z.literal('range'),
    key: z.string(),
    label: z.string(),
    help: z.string().optional(),
    min: z.number(),
    max: z.number(),
    step: z.number().optional(),
    default: z.tuple([z.number(), z.number()]),
    unit: z.string().optional(),
  }),
  z.object({
    kind: z.literal('tags'),
    key: z.string(),
    label: z.string(),
    help: z.string().optional(),
    default: z.array(z.string()),
    placeholder: z.string().optional(),
  }),
  z.object({
    kind: z.literal('toggle'),
    key: z.string(),
    label: z.string(),
    help: z.string().optional(),
    default: z.boolean(),
    locked: z.boolean().optional(),
  }),
]);

function zodForField(field: FieldSpec): z.ZodType<SettingsValue> {
  switch (field.kind) {
    case 'text': {
      const base = z.string().trim().max(300);
      const schema = field.required ? base.min(1, `${field.label} is required`) : base;
      return schema.default(field.default);
    }
    case 'url': {
      const url = z
        .string()
        .trim()
        .max(2000)
        .refine((value) => isHttpUrl(value), `${field.label} must be a web address (https://...)`);
      if (field.required) return url.default(field.default);
      return z.union([z.literal(''), url]).default(field.default);
    }
    case 'select': {
      const schema = z.enum(field.options as [string, ...string[]]).default(field.default);
      return field.locked ? schema.transform(() => field.default) : schema;
    }
    case 'multi':
      return z
        .array(z.enum(field.options as [string, ...string[]]))
        .min(1, `Pick at least one option for ${field.label}`)
        .transform((values) => [...new Set(values)])
        .default(field.default);
    case 'number':
      return z
        .number()
        .min(field.min, `${field.label} must be at least ${field.min}`)
        .max(field.max, `${field.label} must be at most ${field.max}`)
        .default(field.default);
    case 'range':
      return z
        .tuple([z.number().min(field.min).max(field.max), z.number().min(field.min).max(field.max)])
        .refine(
          ([low, high]) => low <= high,
          `${field.label}: the first number must be the lower one`,
        )
        .default(field.default);
    case 'tags':
      return z
        .array(z.string().trim().min(1).max(80))
        .max(50)
        .transform((values) => [...new Set(values)])
        .default(field.default);
    case 'toggle': {
      const schema = z.boolean().default(field.default);
      return field.locked ? schema.transform(() => field.default) : schema;
    }
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Builds the zod object schema for a bot's settings. Unknown keys are dropped. */
export function settingsSchema(fields: readonly FieldSpec[]): z.ZodType<BotSettings> {
  const shape: Record<string, z.ZodType<SettingsValue>> = {};
  for (const field of fields) shape[field.key] = zodForField(field);
  return z.object(shape) as unknown as z.ZodType<BotSettings>;
}

export function defaultSettings(fields: readonly FieldSpec[]): BotSettings {
  const result: BotSettings = {};
  for (const field of fields) {
    result[field.key] =
      field.kind === 'range'
        ? [field.default[0], field.default[1]]
        : Array.isArray(field.default)
          ? [...field.default]
          : field.default;
  }
  return result;
}

export type SettingsParseResult =
  | { ok: true; settings: BotSettings }
  | { ok: false; errors: Record<string, string>; message: string };

/**
 * Validates user input against a bot's fields. Missing keys fall back to the
 * field default, so `parseSettings(fields, {})` returns the defaults.
 */
export function parseSettings(fields: readonly FieldSpec[], input: unknown): SettingsParseResult {
  const candidate = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const parsed = settingsSchema(fields).safeParse(candidate);
  if (parsed.success) return { ok: true, settings: parsed.data };
  const errors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] ?? '_');
    if (!errors[key]) errors[key] = issue.message;
  }
  const first = Object.values(errors)[0] ?? 'Some settings are not valid';
  return { ok: false, errors, message: first };
}

/**
 * JSON Schema for bots.settings_schema, generated from the zod schema.
 * Each property carries the full field description under "x-ui" so the web
 * app can rebuild the form controls from the database row alone.
 */
export function settingsJsonSchema(fields: readonly FieldSpec[]): Json {
  const shape: Record<string, z.ZodType> = {};
  for (const field of fields) {
    shape[field.key] = jsonShapeForField(field).meta({ title: field.label, [UI_KEY]: field });
  }
  return z.toJSONSchema(z.object(shape), { io: 'input', unrepresentable: 'any' }) as Json;
}

/** Plain (transform-free) zod shapes, used only to print the JSON Schema. */
function jsonShapeForField(field: FieldSpec): z.ZodType {
  switch (field.kind) {
    case 'text':
      return z.string().max(300).default(field.default);
    case 'url':
      return z.string().max(2000).default(field.default);
    case 'select':
      return z.enum(field.options as [string, ...string[]]).default(field.default);
    case 'multi':
      return z.array(z.enum(field.options as [string, ...string[]])).default(field.default);
    case 'number':
      return z.number().min(field.min).max(field.max).default(field.default);
    case 'range':
      return z.array(z.number().min(field.min).max(field.max)).length(2).default(field.default);
    case 'tags':
      return z.array(z.string().max(80)).max(50).default(field.default);
    case 'toggle':
      return z.boolean().default(field.default);
  }
}

interface JsonSchemaProperty {
  type?: string;
  title?: string;
  enum?: unknown[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  items?: { type?: string; enum?: unknown[] };
  [UI_KEY]?: unknown;
}

/**
 * Reads the field list back out of a stored JSON Schema. Prefers the "x-ui"
 * hints; falls back to plain JSON Schema keywords so a hand-written bot row
 * still gets a usable form.
 */
export function fieldsFromJsonSchema(schema: unknown): FieldSpec[] {
  if (!schema || typeof schema !== 'object') return [];
  const properties = (schema as { properties?: Record<string, JsonSchemaProperty> }).properties;
  if (!properties || typeof properties !== 'object') return [];
  const fields: FieldSpec[] = [];
  for (const [key, property] of Object.entries(properties)) {
    if (!property || typeof property !== 'object') continue;
    const hinted = fieldSpecSchema.safeParse({ ...(property[UI_KEY] as object), key });
    if (hinted.success) {
      fields.push(hinted.data as FieldSpec);
      continue;
    }
    const inferred = inferField(key, property);
    if (inferred) fields.push(inferred);
  }
  return fields;
}

function inferField(key: string, property: JsonSchemaProperty): FieldSpec | null {
  const label = property.title ?? humanize(key);
  const strings = (values: unknown[] | undefined) =>
    (values ?? []).filter((value): value is string => typeof value === 'string');
  if (property.type === 'boolean') {
    return { kind: 'toggle', key, label, default: property.default === true };
  }
  if (property.type === 'number' || property.type === 'integer') {
    const min = property.minimum ?? 0;
    const max = property.maximum ?? 1000;
    const fallback = typeof property.default === 'number' ? property.default : min;
    return { kind: 'number', key, label, min, max, default: fallback };
  }
  if (property.type === 'string') {
    const options = strings(property.enum);
    const fallback = typeof property.default === 'string' ? property.default : '';
    if (options.length > 0) {
      return { kind: 'select', key, label, options, default: fallback || options[0]! };
    }
    return { kind: 'text', key, label, default: fallback };
  }
  if (property.type === 'array') {
    const options = strings(property.items?.enum);
    const fallback = strings(Array.isArray(property.default) ? property.default : []);
    if (options.length > 0) return { kind: 'multi', key, label, options, default: fallback };
    return { kind: 'tags', key, label, default: fallback };
  }
  return null;
}

function humanize(key: string): string {
  const text = key.replace(/[_-]+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}
