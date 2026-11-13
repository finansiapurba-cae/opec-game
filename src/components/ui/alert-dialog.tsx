import * as React from 'react';
import { AlertDialog as P } from 'radix-ui';
import { cn } from '@/lib/utils';
import { buttonVariants } from './button';

const AlertDialog = P.Root;
const AlertDialogTrigger = P.Trigger;

function AlertDialogContent({ className, ...props }: React.ComponentProps<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Overlay className="fixed inset-0 z-50 bg-navy-950/60 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
      <P.Content
        className={cn(
          'fixed top-1/2 left-1/2 z-50 grid max-h-[90vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-xl border bg-card p-6 shadow-xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          className,
        )}
        {...props}
      />
    </P.Portal>
  );
}
function AlertDialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-2', className)} {...props} />;
}
function AlertDialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />;
}
function AlertDialogTitle({ className, ...props }: React.ComponentProps<typeof P.Title>) {
  return <P.Title className={cn('text-lg font-semibold text-navy-900', className)} {...props} />;
}
function AlertDialogDescription({ className, ...props }: React.ComponentProps<typeof P.Description>) {
  return <P.Description className={cn('text-sm text-muted-foreground', className)} {...props} />;
}
function AlertDialogAction({ className, ...props }: React.ComponentProps<typeof P.Action>) {
  return <P.Action className={cn(buttonVariants(), className)} {...props} />;
}
function AlertDialogCancel({ className, ...props }: React.ComponentProps<typeof P.Cancel>) {
  return <P.Cancel className={cn(buttonVariants({ variant: 'outline' }), className)} {...props} />;
}

export {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
};
