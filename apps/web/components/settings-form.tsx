'use client';

import { useState } from 'react';
import { Controller, type Control, type FieldErrors } from 'react-hook-form';
import { Lock, Minus, Plus, X } from 'lucide-react';
import type { BotSettings, FieldSpec } from '@fgv/shared';
import { Input, Label, Select } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

/**
 * Draws a bot's settings from its field list (which comes from the JSON Schema
 * stored on the bot row). Click-first controls only: selects, chips, toggles,
 * steppers with a slider, and a tag input. No free-text prompt editing here.
 */
export function SettingsFields({
  fields,
  control,
  errors,
  disabled = false,
}: {
  fields: FieldSpec[];
  control: Control<BotSettings>;
  errors: FieldErrors<BotSettings>;
  disabled?: boolean;
}) {
  if (fields.length === 0) {
    return <p className="text-sm text-muted-foreground">This bot has no settings.</p>;
  }
  return (
    <div className="flex flex-col gap-6">
      {fields.map((field) => {
        const locked = ('locked' in field && field.locked) || false;
        const message = errors[field.key]?.message;
        return (
          <div key={field.key} className="flex flex-col gap-2" data-field={field.key}>
            <div className="flex items-center gap-2">
              <Label htmlFor={`field-${field.key}`}>{field.label}</Label>
              {locked ? (
                <Lock className="size-3.5 text-muted-foreground" aria-label="Locked" />
              ) : null}
            </div>
            <Controller
              name={field.key}
              control={control}
              render={({ field: form }) => (
                <FieldControl
                  field={field}
                  value={form.value}
                  onChange={form.onChange}
                  disabled={disabled || locked}
                />
              )}
            />
            {field.help ? <p className="text-xs text-muted-foreground">{field.help}</p> : null}
            {typeof message === 'string' ? (
              <p className="text-sm text-destructive" role="alert">
                {message}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function FieldControl({
  field,
  value,
  onChange,
  disabled,
}: {
  field: FieldSpec;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled: boolean;
}) {
  const id = `field-${field.key}`;
  switch (field.kind) {
    case 'text':
    case 'url':
      return (
        <Input
          id={id}
          type={field.kind === 'url' ? 'url' : 'text'}
          inputMode={field.kind === 'url' ? 'url' : 'text'}
          value={typeof value === 'string' ? value : ''}
          placeholder={field.placeholder}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    case 'select':
      // a few options: big tappable chips; many: a native picker
      return field.options.length <= 4 ? (
        <Chips
          options={field.options}
          selected={[typeof value === 'string' ? value : field.default]}
          disabled={disabled}
          onToggle={(option) => onChange(option)}
          single
        />
      ) : (
        <Select
          id={id}
          value={typeof value === 'string' ? value : field.default}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        >
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      );
    case 'multi': {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      const all = selected.length === field.options.length;
      return (
        <div className="flex flex-col gap-2">
          <Chips
            options={field.options}
            selected={selected}
            disabled={disabled}
            onToggle={(option) =>
              onChange(
                selected.includes(option)
                  ? selected.filter((entry) => entry !== option)
                  : // keep the order of the options list
                    field.options.filter((entry) => entry === option || selected.includes(entry)),
              )
            }
          />
          {field.options.length > 4 && !disabled ? (
            <button
              type="button"
              className="h-11 self-start text-sm font-medium text-primary"
              onClick={() => onChange(all ? [] : [...field.options])}
            >
              {all ? 'Clear all' : 'Select all'}
            </button>
          ) : null}
        </div>
      );
    }
    case 'number':
      return (
        <Stepper
          id={id}
          value={typeof value === 'number' ? value : field.default}
          min={field.min}
          max={field.max}
          step={field.step ?? 1}
          unit={field.unit}
          disabled={disabled}
          onChange={onChange}
          slider
        />
      );
    case 'range': {
      const pair: [number, number] =
        Array.isArray(value) && value.length === 2
          ? [Number(value[0]), Number(value[1])]
          : field.default;
      return (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <span className="w-10 text-sm text-muted-foreground">From</span>
            <Stepper
              value={pair[0]}
              min={field.min}
              max={field.max}
              step={field.step ?? 1}
              disabled={disabled}
              onChange={(next) => onChange([next, Math.max(next, pair[1])])}
            />
          </div>
          <div className="flex items-center gap-3">
            <span className="w-10 text-sm text-muted-foreground">To</span>
            <Stepper
              value={pair[1]}
              min={field.min}
              max={field.max}
              step={field.step ?? 1}
              unit={field.unit}
              disabled={disabled}
              onChange={(next) => onChange([Math.min(next, pair[0]), next])}
            />
          </div>
        </div>
      );
    }
    case 'tags':
      return (
        <TagInput
          id={id}
          value={Array.isArray(value) ? (value as string[]) : []}
          placeholder={field.placeholder}
          disabled={disabled}
          onChange={onChange}
        />
      );
    case 'toggle':
      return (
        <Switch
          id={id}
          checked={value === true}
          disabled={disabled}
          onCheckedChange={(checked) => onChange(checked)}
        />
      );
  }
}

function Chips({
  options,
  selected,
  onToggle,
  disabled,
  single = false,
}: {
  options: string[];
  selected: string[];
  onToggle: (option: string) => void;
  disabled?: boolean;
  single?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2" role={single ? 'radiogroup' : 'group'}>
      {options.map((option) => {
        const active = selected.includes(option);
        return (
          <button
            key={option}
            type="button"
            role={single ? 'radio' : 'checkbox'}
            aria-checked={active}
            disabled={disabled}
            onClick={() => onToggle(option)}
            className={cn(
              'min-h-11 rounded-full border px-4 text-sm font-medium transition-colors disabled:opacity-60',
              active
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-input bg-card text-foreground hover:bg-muted',
            )}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function Stepper({
  id,
  value,
  min,
  max,
  step,
  unit,
  disabled,
  onChange,
  slider = false,
}: {
  id?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
  slider?: boolean;
}) {
  const set = (next: number) => onChange(clamp(Math.round(next / step) * step, min, max));
  const buttonClass =
    'inline-flex size-11 shrink-0 items-center justify-center rounded-lg border border-input bg-card hover:bg-muted disabled:opacity-50';
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={buttonClass}
          aria-label="Less"
          disabled={disabled || value <= min}
          onClick={() => set(value - step)}
        >
          <Minus className="size-4" />
        </button>
        <output
          id={id}
          className="min-w-16 rounded-lg bg-muted px-3 py-2.5 text-center text-base font-semibold tabular-nums"
          aria-live="polite"
        >
          {value.toLocaleString('en-US')}
        </output>
        <button
          type="button"
          className={buttonClass}
          aria-label="More"
          disabled={disabled || value >= max}
          onClick={() => set(value + step)}
        >
          <Plus className="size-4" />
        </button>
        {unit ? <span className="text-sm text-muted-foreground">{unit}</span> : null}
      </div>
      {slider ? (
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          aria-label="Slider"
          onChange={(event) => set(Number(event.target.value))}
          className="h-11 w-full accent-[var(--primary)]"
        />
      ) : null}
    </div>
  );
}

function TagInput({
  id,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  id: string;
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const parts = draft
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0 && !value.includes(part));
    if (parts.length > 0) onChange([...value, ...parts]);
    setDraft('');
  };
  return (
    <div className="flex flex-col gap-2">
      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {value.map((tag) => (
            <li
              key={tag}
              className="inline-flex min-h-9 items-center gap-1 rounded-full bg-accent pr-1 pl-3 text-sm text-accent-foreground"
            >
              {tag}
              <button
                type="button"
                disabled={disabled}
                aria-label={`Remove ${tag}`}
                className="inline-flex size-8 items-center justify-center rounded-full hover:bg-black/10"
                onClick={() => onChange(value.filter((entry) => entry !== tag))}
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex gap-2">
        <Input
          id={id}
          value={draft}
          placeholder={placeholder ?? 'Type and press Enter'}
          disabled={disabled}
          enterKeyHint="done"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={add}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ',') {
              event.preventDefault();
              add();
            }
          }}
        />
        <button
          type="button"
          disabled={disabled || draft.trim().length === 0}
          onClick={add}
          className="inline-flex h-11 shrink-0 items-center rounded-lg border border-input bg-card px-4 text-sm font-medium disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </div>
  );
}
