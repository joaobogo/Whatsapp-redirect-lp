'use client';

import * as React from 'react';
import { Switch as SwitchPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

/** The visible track is 28px tall; the padding makes the tap target 44px. */
export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'group inline-flex h-11 w-14 shrink-0 cursor-pointer items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <span className="flex h-7 w-12 items-center rounded-full bg-input px-0.5 transition-colors group-data-[state=checked]:bg-primary">
        <SwitchPrimitive.Thumb className="block size-6 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-5" />
      </span>
    </SwitchPrimitive.Root>
  );
}
