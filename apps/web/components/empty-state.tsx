import { cn } from '@/lib/utils';

export function EmptyState({
  title,
  text,
  children,
  className,
}: {
  title: string;
  text?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center',
        className,
      )}
    >
      <p className="text-base font-medium">{title}</p>
      {text ? <p className="max-w-sm text-sm text-muted-foreground">{text}</p> : null}
      {children}
    </div>
  );
}
