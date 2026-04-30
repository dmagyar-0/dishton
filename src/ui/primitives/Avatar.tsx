import { forwardRef, useState } from 'react';
import type { HTMLAttributes } from 'react';

import { cn } from '@/ui/cn';

export type AvatarProps = HTMLAttributes<HTMLSpanElement> & {
  src?: string;
  alt?: string;
  name?: string;
  size?: number;
};

function getInitials(name: string | undefined): string {
  if (!name) return '';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('');
}

export const Avatar = forwardRef<HTMLSpanElement, AvatarProps>(
  ({ className, src, alt, name, size = 40, style, ...rest }, ref) => {
    const [errored, setErrored] = useState(false);
    const showImage = src && !errored;
    const initials = getInitials(name);

    return (
      <span
        ref={ref}
        className={cn(
          'inline-flex shrink-0 items-center justify-center overflow-hidden',
          'rounded-full bg-saffron text-saffron-ink font-display font-semibold uppercase',
          className,
        )}
        style={{ width: size, height: size, ...style }}
        {...rest}
      >
        {showImage ? (
          <img
            src={src}
            alt={alt ?? name ?? ''}
            onError={() => setErrored(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <span aria-hidden={!name} style={{ fontSize: Math.max(10, size / 2.5) }}>
            {initials || '?'}
          </span>
        )}
      </span>
    );
  },
);
Avatar.displayName = 'Avatar';
