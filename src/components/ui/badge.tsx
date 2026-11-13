import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center justify-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap shrink-0 [&>svg]:size-3',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-navy-900 text-white',
        gold: 'border-gold-500/40 bg-accent text-accent-foreground',
        success: 'border-oil-600/30 bg-green-50 text-oil-600',
        warning: 'border-amber-300 bg-amber-50 text-amber-800',
        destructive: 'border-red-200 bg-red-50 text-red-700',
        outline: 'text-foreground bg-white',
        muted: 'border-transparent bg-muted text-muted-foreground',
        navOutline: 'border-white/25 text-white/90',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

function Badge({ className, variant, ...props }: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
