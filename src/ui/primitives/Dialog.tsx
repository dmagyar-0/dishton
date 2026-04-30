import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { forwardRef } from 'react';
import type { ComponentPropsWithoutRef, HTMLAttributes, ReactNode } from 'react';

import { cn } from '@/ui/cn';

export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogPortal = RadixDialog.Portal;
export const DialogClose = RadixDialog.Close;

export const DialogOverlay = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RadixDialog.Overlay>
>(({ className, ...rest }, ref) => (
  <RadixDialog.Overlay
    ref={ref}
    className={cn('fixed inset-0 z-40 bg-paper/60', className)}
    {...rest}
  />
));
DialogOverlay.displayName = 'DialogOverlay';

export type DialogContentProps = ComponentPropsWithoutRef<typeof RadixDialog.Content> & {
  hideCloseButton?: boolean;
  closeLabel?: string;
};

export const DialogContent = forwardRef<HTMLDivElement, DialogContentProps>(
  ({ className, children, hideCloseButton, closeLabel = 'Close dialog', ...rest }, ref) => (
    <DialogPortal>
      <DialogOverlay />
      <RadixDialog.Content
        ref={ref}
        className={cn(
          'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
          'w-[min(calc(100vw-2rem),32rem)] max-w-lg',
          'bg-paper-2 border border-cream-line shadow-press-lg rounded-[var(--radius-lg)] p-6',
          'text-ink outline-none',
          className,
        )}
        {...rest}
      >
        {children}
        {!hideCloseButton && (
          <DialogClose
            aria-label={closeLabel}
            className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] text-ink hover:bg-paper"
          >
            <X aria-hidden="true" size={16} strokeWidth={1.5} />
          </DialogClose>
        )}
      </RadixDialog.Content>
    </DialogPortal>
  ),
);
DialogContent.displayName = 'DialogContent';

export function DialogHeader({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mb-4 flex flex-col gap-1', className)} {...rest} />;
}

export function DialogFooter({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...rest}
    />
  );
}

export const DialogTitle = forwardRef<
  HTMLHeadingElement,
  ComponentPropsWithoutRef<typeof RadixDialog.Title>
>(({ className, ...rest }, ref) => (
  <RadixDialog.Title
    ref={ref}
    className={cn('font-display text-2xl text-ink', className)}
    {...rest}
  />
));
DialogTitle.displayName = 'DialogTitle';

export const DialogDescription = forwardRef<
  HTMLParagraphElement,
  ComponentPropsWithoutRef<typeof RadixDialog.Description>
>(({ className, ...rest }, ref) => (
  <RadixDialog.Description
    ref={ref}
    className={cn('font-body text-sm text-ink-soft', className)}
    {...rest}
  />
));
DialogDescription.displayName = 'DialogDescription';

export type DialogChildren = { children?: ReactNode };
