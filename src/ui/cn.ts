import clsx, { type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Tailwind-class-aware merge helper. Used by every primitive's className prop. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(...inputs));
}
