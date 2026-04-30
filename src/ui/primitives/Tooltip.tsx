import { cloneElement, isValidElement, useId, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { cn } from '@/ui/cn';

export type TooltipProps = {
  content: ReactNode;
  children: ReactElement;
  side?: 'top' | 'bottom';
  className?: string;
};

type TriggerProps = {
  onMouseEnter?: (e: React.MouseEvent) => void;
  onMouseLeave?: (e: React.MouseEvent) => void;
  onFocus?: (e: React.FocusEvent) => void;
  onBlur?: (e: React.FocusEvent) => void;
  'aria-describedby'?: string;
};

export function Tooltip({ content, children, side = 'top', className }: TooltipProps) {
  const id = useId();
  const [visible, setVisible] = useState(false);

  if (!isValidElement(children)) {
    throw new Error('Tooltip children must be a single React element');
  }

  const childProps = (children.props ?? {}) as TriggerProps;

  const trigger = cloneElement(children as ReactElement<TriggerProps>, {
    'aria-describedby': visible ? id : childProps['aria-describedby'],
    onMouseEnter: (e: React.MouseEvent) => {
      setVisible(true);
      childProps.onMouseEnter?.(e);
    },
    onMouseLeave: (e: React.MouseEvent) => {
      setVisible(false);
      childProps.onMouseLeave?.(e);
    },
    onFocus: (e: React.FocusEvent) => {
      setVisible(true);
      childProps.onFocus?.(e);
    },
    onBlur: (e: React.FocusEvent) => {
      setVisible(false);
      childProps.onBlur?.(e);
    },
  });

  return (
    <span className="relative inline-flex">
      {trigger}
      <span
        id={id}
        role="tooltip"
        aria-hidden={!visible}
        className={cn(
          'pointer-events-none absolute left-1/2 z-30 -translate-x-1/2',
          'whitespace-nowrap rounded-[var(--radius-sm)] border border-cream-line',
          'bg-aubergine text-paper font-body text-xs px-2 py-1 shadow-press',
          'transition-opacity duration-[var(--duration-fast)]',
          visible ? 'opacity-100' : 'opacity-0',
          side === 'top' ? '-top-2 -translate-y-full' : 'top-full mt-2',
          className,
        )}
      >
        {content}
      </span>
    </span>
  );
}
