/**
 * Schedule presets shown in the bot settings page. Times are America/Sao_Paulo.
 * A schedule may hold several cron expressions separated by ";" because
 * "nights and weekends" cannot be written as one expression.
 */
export interface SchedulePreset {
  id: string;
  label: string;
  cron: string | null;
}

export const SCHEDULE_PRESETS: readonly SchedulePreset[] = [
  { id: 'manual', label: 'Manual only', cron: null },
  { id: 'hourly', label: 'Every hour', cron: '0 * * * *' },
  { id: 'every-2h', label: 'Every 2 hours', cron: '0 */2 * * *' },
  { id: 'every-4h', label: 'Every 4 hours', cron: '0 */4 * * *' },
  { id: 'weekdays-9', label: 'Weekdays 09:00', cron: '0 9 * * 1-5' },
  { id: 'daily-8', label: 'Every day 08:00', cron: '0 8 * * *' },
  {
    id: 'nights-weekends',
    label: 'Nights and weekends',
    // every 2h from 20:00 to 06:00 on weekdays, and every 2h all weekend
    cron: '0 20,22,0,2,4,6 * * 1-5;0 */2 * * 0,6',
  },
];

export function presetForCron(cron: string | null): SchedulePreset | undefined {
  const normalized = normalizeCron(cron);
  return SCHEDULE_PRESETS.find((preset) => normalizeCron(preset.cron) === normalized);
}

export function presetById(id: string): SchedulePreset | undefined {
  return SCHEDULE_PRESETS.find((preset) => preset.id === id);
}

export function scheduleLabel(cron: string | null): string {
  if (!cron) return 'Manual only';
  return presetForCron(cron)?.label ?? `Custom (${cron})`;
}

/** Splits a stored schedule into its individual cron expressions. */
export function splitCron(cron: string | null): string[] {
  if (!cron) return [];
  return cron
    .split(';')
    .map((part) => part.trim().replace(/\s+/g, ' '))
    .filter((part) => part.length > 0);
}

function normalizeCron(cron: string | null): string {
  return splitCron(cron).join(';');
}

const CRON_FIELD = /^[\d*/,-]+$/;

/** Light check that a schedule is made of 5-field cron expressions. */
export function isValidSchedule(cron: string | null): boolean {
  if (cron === null) return true;
  const parts = splitCron(cron);
  if (parts.length === 0) return false;
  return parts.every((part) => {
    const fields = part.split(' ');
    return fields.length === 5 && fields.every((field) => CRON_FIELD.test(field));
  });
}
