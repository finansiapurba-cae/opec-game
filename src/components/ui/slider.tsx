import * as React from 'react';
import { Slider as SliderPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

function Slider({
  className,
  rangeClassName,
  'aria-label': ariaLabel,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root> & { rangeClassName?: string }) {
  const count = (props.value ?? props.defaultValue ?? [0]).length;
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn('relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50 py-2', className)}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-2 w-full grow overflow-hidden rounded-full bg-muted">
        <SliderPrimitive.Range className={cn('absolute h-full bg-gold-500', rangeClassName)} />
      </SliderPrimitive.Track>
      {Array.from({ length: count }, (_, i) => (
        <SliderPrimitive.Thumb
          key={i}
          aria-label={ariaLabel}
          className="block size-5 shrink-0 rounded-full border-2 border-navy-900 bg-white shadow-sm transition-[color,box-shadow] hover:ring-4 hover:ring-gold-300/50 focus-visible:ring-4 focus-visible:ring-gold-300/70 focus-visible:outline-hidden disabled:pointer-events-none"
        />
      ))}
    </SliderPrimitive.Root>
  );
}

export { Slider };
