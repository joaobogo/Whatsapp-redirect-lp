import * as React from 'react';
import { cn } from '@/lib/utils';

const fieldClass =
  'w-full rounded-lg border border-input bg-card px-3 text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60';

export function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return <input className={cn(fieldClass, 'h-11', className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea className={cn(fieldClass, 'min-h-28 py-2.5 leading-relaxed', className)} {...props} />
  );
}

export function Select({ className, children, ...props }: React.ComponentProps<'select'>) {
  return (
    <select className={cn(fieldClass, 'h-11 appearance-auto pr-8', className)} {...props}>
      {children}
    </select>
  );
}

export function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return <label className={cn('text-sm font-medium text-foreground', className)} {...props} />;
}
