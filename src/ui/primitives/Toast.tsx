import { X } from 'lucide-react';
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { create } from 'zustand';

import { cn } from '@/ui/cn';

export type ToastVariant = 'info' | 'success' | 'error';

export type Toast = {
  id: string;
  title?: string;
  description?: ReactNode;
  variant?: ToastVariant;
  persist?: boolean;
};

type ToastInput = Omit<Toast, 'id'> & { id?: string };

type ToastStore = {
  toasts: Toast[];
  push: (toast: ToastInput) => string;
  remove: (id: string) => void;
  clear: () => void;
};

let counter = 0;
const genId = (): string => {
  counter += 1;
  return `t-${Date.now().toString(36)}-${counter}`;
};

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  push: (toast) => {
    const id = toast.id ?? genId();
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }));
    return id;
  },
  remove: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

export function useToast() {
  const push = useToastStore((s) => s.push);
  const remove = useToastStore((s) => s.remove);
  return { push, remove } as const;
}

const variantClasses: Record<ToastVariant, string> = {
  info: 'border-cream-line',
  success: 'border-sage',
  error: 'border-pomegranate',
};

function ToastItem({ toast }: { toast: Toast }) {
  const remove = useToastStore((s) => s.remove);

  useEffect(() => {
    if (toast.persist) return;
    const handle = window.setTimeout(() => remove(toast.id), 5000);
    return () => window.clearTimeout(handle);
  }, [toast.id, toast.persist, remove]);

  return (
    <li
      role="status"
      aria-live="polite"
      className={cn(
        'pointer-events-auto flex min-w-[16rem] max-w-sm items-start gap-3',
        'rounded-[var(--radius-md)] border bg-aubergine text-paper px-4 py-3 shadow-press-lg',
        variantClasses[toast.variant ?? 'info'],
      )}
    >
      <div className="flex-1">
        {toast.title && <p className="font-display text-base">{toast.title}</p>}
        {toast.description != null && (
          <div className="font-body text-sm text-paper">{toast.description}</div>
        )}
      </div>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={() => remove(toast.id)}
        className="inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-paper hover:bg-aubergine/70"
      >
        <X aria-hidden="true" size={14} strokeWidth={1.5} />
      </button>
    </li>
  );
}

export function Toaster({ className }: { className?: string }) {
  const toasts = useToastStore((s) => s.toasts);
  return (
    <ul
      aria-label="Notifications"
      className={cn(
        'pointer-events-none fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col gap-2',
        className,
      )}
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </ul>
  );
}
