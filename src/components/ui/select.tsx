import * as React from 'react';
import { Select as P } from 'radix-ui';
import { CheckIcon, ChevronDownIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

const Select = P.Root;
const SelectValue = P.Value;

function SelectTrigger({ className, children, ...props }: React.ComponentProps<typeof P.Trigger>) {
  return (
    <P.Trigger
      className={cn(
        'flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-white px-3 py-2 text-sm whitespace-nowrap shadow-xs outline-none focus-visible:border-gold-500 focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 data-[placeholder]:text-muted-foreground [&>span]:truncate',
        className,
      )}
      {...props}
    >
      {children}
      <P.Icon asChild>
        <ChevronDownIcon className="size-4 opacity-50" />
      </P.Icon>
    </P.Trigger>
  );
}
function SelectContent({ className, children, position = 'popper', ...props }: React.ComponentProps<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content
        position={position}
        className={cn(
          'relative z-50 max-h-80 min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=open]:fade-in-0',
          position === 'popper' && 'w-full min-w-[var(--radix-select-trigger-width)] data-[side=bottom]:translate-y-1',
          className,
        )}
        {...props}
      >
        <P.Viewport className="p-1">{children}</P.Viewport>
      </P.Content>
    </P.Portal>
  );
}
function SelectItem({ className, children, ...props }: React.ComponentProps<typeof P.Item>) {
  return (
    <P.Item
      className={cn(
        'relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none focus:bg-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <span className="absolute right-2 flex size-3.5 items-center justify-center">
        <P.ItemIndicator>
          <CheckIcon className="size-4" />
        </P.ItemIndicator>
      </span>
      <P.ItemText>{children}</P.ItemText>
    </P.Item>
  );
}

export { Select, SelectValue, SelectTrigger, SelectContent, SelectItem };
