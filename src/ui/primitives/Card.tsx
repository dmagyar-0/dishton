import { forwardRef } from 'react';
import type { ElementType, HTMLAttributes, ReactElement, Ref } from 'react';

import { cn } from '@/ui/cn';

type PolymorphicProps<E extends ElementType> = HTMLAttributes<HTMLElement> & {
  as?: E;
};

type CardComponent = <E extends ElementType = 'div'>(
  props: PolymorphicProps<E> & { ref?: Ref<HTMLElement> },
) => ReactElement | null;

export const Card = forwardRef<HTMLElement, PolymorphicProps<ElementType>>(
  ({ as, className, ...rest }, ref) => {
    const Component = (as ?? 'div') as ElementType;
    return (
      <Component
        ref={ref}
        className={cn(
          'bg-paper-2 border border-cream-line shadow-press rounded-[var(--radius-lg)] p-6 text-ink',
          className,
        )}
        {...rest}
      />
    );
  },
) as unknown as CardComponent & { displayName?: string };
(Card as { displayName?: string }).displayName = 'Card';
