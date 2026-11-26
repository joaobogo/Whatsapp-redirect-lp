'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { OctagonX, Play } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { resumeAllAction, stopAllAction } from '@/lib/actions';

export function StopAllButton() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const confirm = () =>
    startTransition(async () => {
      const result = await stopAllAction();
      if (result.ok) {
        toast.success('All bots are stopping.');
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });

  return (
    <>
      <Button variant="destructive" onClick={() => setOpen(true)} data-testid="stop-all">
        <OctagonX />
        Stop all
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title="Stop every running bot?"
          description="Running bots stop within about 15 seconds and queued runs are cancelled. Nothing starts again until you press Resume."
        >
          <DialogBody className="hidden" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirm}
              disabled={pending}
              data-testid="stop-all-confirm"
            >
              {pending ? 'Stopping...' : 'Stop all'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function KillBanner({ canResume }: { canResume: boolean }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const resume = () =>
    startTransition(async () => {
      const result = await resumeAllAction();
      if (result.ok) {
        toast.success('Bots can run again.');
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });

  return (
    <div
      role="status"
      data-testid="kill-banner"
      className="flex flex-wrap items-center justify-between gap-3 bg-destructive px-4 py-3 text-destructive-foreground md:pl-60"
    >
      <p className="flex items-center gap-2 text-sm font-semibold">
        <OctagonX className="size-5 shrink-0" />
        All bots are stopped
      </p>
      {canResume ? (
        <Button
          variant="secondary"
          onClick={resume}
          disabled={pending}
          data-testid="resume-all"
          className="bg-white text-black hover:bg-white/90"
        >
          <Play />
          {pending ? 'Resuming...' : 'Resume'}
        </Button>
      ) : null}
    </div>
  );
}
