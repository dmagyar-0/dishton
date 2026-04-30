import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { forwardRef } from 'react';
import type { ComponentPropsWithoutRef, HTMLAttributes } from 'react';

import { cn } from '@/ui/cn';

export const Drawer = RadixDialog.Root;
export const DrawerTrigger = RadixDialog.Trigger;
export const DrawerPortal = RadixDialog.Portal;
export const DrawerClose = RadixDialog.Close;

export const DrawerOverlay = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RadixDialog.Overlay>
>(({ className, ...rest }, ref) => (
  <RadixDialog.Overlay
    ref={ref}
    className={cn('fixed inset-0 z-40 bg-paper/60', className)}
    {...rest}
  />
));
DrawerOverlay.displayName = 'DrawerOverlay';

type DrawerSide = 'bottom' | 'right';

export type DrawerContentProps = ComponentPropsWithoutRef<typeof RadixDialog.Content> & {
  side?: DrawerSide;
  hideCloseButton?: boolean;
  closeLabel?: string;
};

const sideClasses: Record<DrawerSide, string> = {
  bottom:
    'left-0 right-0 bottom-0 max-h-[85vh] w-full rounded-t-[var(--radius-lg)] border-t border-cream-line',
  right:
    'top-0 right-0 bottom-0 h-full w-[min(100vw,28rem)] rounded-l-[var(--radius-lg)] border-l border-cream-line',
};

export const DrawerContent = forwardRef<HTMLDivElement, DrawerContentProps>(
  (
    { className, children, side = 'bottom', hideCloseButton, closeLabel = 'Close drawer', ...rest },
    ref,
  ) => (
    <DrawerPortal>
      <DrawerOverlay />
      <RadixDialog.Content
        ref={ref}
        data-side={side}
        className={cn(
          'fixed z-50 flex flex-col bg-paper-2 shadow-press-lg p-6 text-ink outline-none',
          sideClasses[side],
          className,
        )}
        {...rest}
      >
        {children}
        {!hideCloseButton && (
          <DrawerClose
            aria-label={closeLabel}
            className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] text-ink hover:bg-paper"
          >
            <X aria-hidden="true" size={16} strokeWidth={1.5} />
          </DrawerClose>
        )}
      </RadixDialog.Content>
    </DrawerPortal>
  ),
);
DrawerContent.displayName = 'DrawerContent';

export function DrawerHeader({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mb-4 flex flex-col gap-1', className)} {...rest} />;
}

export const DrawerTitle = forwardRef<
  HTMLHeadingElement,
  ComponentPropsWithoutRef<typeof RadixDialog.Title>
>(({ className, ...rest }, ref) => (
  <RadixDialog.Title
    ref={ref}
    className={cn('font-display text-2xl text-ink', className)}
    {...rest}
  />
));
DrawerTitle.displayName = 'DrawerTitle';

export const DrawerDescription = forwardRef<
  HTMLParagraphElement,
  ComponentPropsWithoutRef<typeof RadixDialog.Description>
>(({ className, ...rest }, ref) => (
  <RadixDialog.Description
    ref={ref}
    className={cn('font-body text-sm text-ink-soft', className)}
    {...rest}
  />
));
DrawerDescription.displayName = 'DrawerDescription';
