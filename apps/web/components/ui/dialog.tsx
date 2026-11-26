'use client';

import * as React from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

function Overlay() {
  return (
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 animate-[fade-in_150ms_ease-out] bg-black/50" />
  );
}

type ContentProps = React.ComponentProps<typeof DialogPrimitive.Content> & {
  /**
   * center: small confirm dialog.
   * bottom: bottom sheet on a phone, centred card on a desktop.
   * side:   full-screen sheet on a phone, right-hand drawer on a desktop.
   */
  placement?: 'center' | 'bottom' | 'side';
  title: string;
  description?: string;
  hideTitle?: boolean;
};

const placements: Record<NonNullable<ContentProps['placement']>, string> = {
  center:
    'top-1/2 left-1/2 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl animate-[fade-in_150ms_ease-out]',
  bottom:
    'inset-x-0 bottom-0 max-h-[92dvh] rounded-t-2xl animate-[sheet-up_200ms_ease-out] md:inset-x-auto md:top-1/2 md:bottom-auto md:left-1/2 md:w-full md:max-w-lg md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-xl md:animate-[fade-in_150ms_ease-out]',
  side: 'inset-0 animate-[sheet-up_200ms_ease-out] md:left-auto md:w-[26rem] md:border-l md:animate-[sheet-right_200ms_ease-out]',
};

export function DialogContent({
  className,
  children,
  placement = 'center',
  title,
  description,
  hideTitle = false,
  ...props
}: ContentProps) {
  return (
    <DialogPrimitive.Portal>
      <Overlay />
      <DialogPrimitive.Content
        className={cn(
          'fixed z-50 flex flex-col bg-card text-card-foreground shadow-xl outline-none',
          placements[placement],
          className,
        )}
        {...props}
      >
        <div
          className={cn(
            'flex items-start justify-between gap-3 border-b p-4',
            hideTitle && 'sr-only',
          )}
        >
          <div className="min-w-0">
            <DialogPrimitive.Title className="text-base font-semibold">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
                {description}
              </DialogPrimitive.Description>
            ) : (
              <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close
            className="-m-2 inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
            aria-label="Close"
          >
            <X className="size-5" />
          </DialogPrimitive.Close>
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogBody({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('min-h-0 flex-1 overflow-y-auto p-4', className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex flex-col-reverse gap-2 border-t p-4 pb-safe-4 sm:flex-row sm:justify-end',
        className,
      )}
      {...props}
    />
  );
}
