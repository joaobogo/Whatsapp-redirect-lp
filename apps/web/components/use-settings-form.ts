'use client';

import { useMemo } from 'react';
import { useForm, type Resolver, type UseFormReturn } from 'react-hook-form';
import { parseSettings, type BotSettings, type FieldSpec } from '@fgv/shared';

/** react-hook-form wired to the bot's zod schema (the same one the server checks). */
export function useSettingsForm(
  fields: FieldSpec[],
  values: BotSettings,
): UseFormReturn<BotSettings> {
  const resolver = useMemo<Resolver<BotSettings>>(
    () => async (input) => {
      const result = parseSettings(fields, input);
      if (result.ok) return { values: result.settings, errors: {} };
      return {
        values: {},
        errors: Object.fromEntries(
          Object.entries(result.errors).map(([key, message]) => [
            key,
            { type: 'validate', message },
          ]),
        ),
      };
    },
    [fields],
  );
  return useForm<BotSettings>({ defaultValues: values, resolver, mode: 'onSubmit' });
}
