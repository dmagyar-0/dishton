import * as RadixTabs from '@radix-ui/react-tabs';
import { forwardRef } from 'react';
import type { ComponentPropsWithoutRef } from 'react';

import { cn } from '@/ui/cn';

export const Tabs = RadixTabs.Root;

export const TabsList = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<typeof RadixTabs.List>>(
  ({ className, ...rest }, ref) => (
    <RadixTabs.List
      ref={ref}
      className={cn('flex flex-wrap items-center gap-2 border-b border-cream-line', className)}
      {...rest}
    />
  ),
);
TabsList.displayName = 'TabsList';

export const TabsTrigger = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<typeof RadixTabs.Trigger>
>(({ className, ...rest }, ref) => (
  <RadixTabs.Trigger
    ref={ref}
    className={cn(
      'relative inline-flex items-center px-3 py-2 font-body text-ink-soft',
      'transition-colors duration-[var(--duration-fast)]',
      'data-[state=active]:text-ink',
      'after:pointer-events-none after:absolute after:bottom-[-1px] after:left-0 after:right-0 after:h-[2px]',
      'after:bg-saffron after:scale-x-0 after:origin-left',
      'after:transition-transform after:duration-[var(--duration-base)]',
      'data-[state=active]:after:scale-x-100',
      'disabled:cursor-not-allowed disabled:opacity-60',
      className,
    )}
    {...rest}
  />
));
TabsTrigger.displayName = 'TabsTrigger';

export const TabsContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RadixTabs.Content>
>(({ className, ...rest }, ref) => (
  <RadixTabs.Content ref={ref} className={cn('mt-4 outline-none', className)} {...rest} />
));
TabsContent.displayName = 'TabsContent';
