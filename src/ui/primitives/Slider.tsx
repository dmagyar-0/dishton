import * as RadixSlider from '@radix-ui/react-slider';
import { forwardRef } from 'react';
import type { ComponentPropsWithoutRef } from 'react';

import { cn } from '@/ui/cn';

export type SliderProps = ComponentPropsWithoutRef<typeof RadixSlider.Root> & {
  thumbLabels?: string[];
};

export const Slider = forwardRef<HTMLSpanElement, SliderProps>(
  ({ className, thumbLabels, 'aria-label': ariaLabel, ...rest }, ref) => {
    const values = rest.value ?? rest.defaultValue ?? [0];
    return (
      <RadixSlider.Root
        ref={ref}
        className={cn(
          'relative flex w-full touch-none items-center select-none',
          'data-[orientation=horizontal]:h-5',
          'data-[disabled]:opacity-60 data-[disabled]:cursor-not-allowed',
          className,
        )}
        {...rest}
      >
        <RadixSlider.Track
          className={cn(
            'relative grow overflow-hidden rounded-[var(--radius-pill)] bg-paper-2',
            'data-[orientation=horizontal]:h-2',
          )}
        >
          <RadixSlider.Range className="absolute h-full bg-saffron" />
        </RadixSlider.Track>
        {values.map((_, index) => {
          const label =
            thumbLabels?.[index] ??
            (values.length === 1 ? ariaLabel : undefined) ??
            `Slider thumb ${index + 1}`;
          return (
            <RadixSlider.Thumb
              // biome-ignore lint/suspicious/noArrayIndexKey: thumbs are positionally stable per Radix API
              key={index}
              aria-label={label}
              className={cn(
                'block h-4 w-4 rounded-[var(--radius-pill)] bg-ink shadow-press',
                'transition-transform duration-[var(--duration-fast)]',
                'hover:scale-110 focus-visible:scale-110',
              )}
            />
          );
        })}
      </RadixSlider.Root>
    );
  },
);
Slider.displayName = 'Slider';
