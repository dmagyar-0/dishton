import { isTypingIntoInput } from '@/lib/shortcuts';
import { cn } from '@/ui/cn';
import { IconButton } from '@/ui/primitives/IconButton';
import { Input } from '@/ui/primitives/Input';
import { Search as SearchIcon, X } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export type SearchBarProps = {
  value: string;
  onChange: (value: string) => void;
  loading?: boolean;
  className?: string;
  placeholder?: string;
  /**
   * Optional control rendered inside the bar, to the right of a hairline
   * divider (e.g. the Home category filter button). Omitted, the bar is a plain
   * search field.
   */
  trailing?: ReactNode;
};

export function SearchBar({
  value,
  onChange,
  loading = false,
  className,
  placeholder,
  trailing,
}: SearchBarProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLInputElement>(null);
  const [local, setLocal] = useState(value);

  useEffect(() => {
    setLocal(value);
  }, [value]);

  useEffect(() => {
    const id = setTimeout(() => {
      if (local !== value) onChange(local);
    }, 200);
    return () => clearTimeout(id);
  }, [local, value, onChange]);

  useEffect(() => {
    // `s` focuses the search box per src/lib/shortcuts.ts. Reuse the central
    // isTypingIntoInput guard so the binding stays consistent with the rest of
    // the shortcut registry, and ignore meta/ctrl so browser combos (e.g.
    // Cmd+S / Ctrl+S) are never intercepted.
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingIntoInput(e)) return;
      if (e.key === 's') {
        e.preventDefault();
        ref.current?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-[var(--radius-lg)] border border-cream-line bg-paper-2 px-3.5 py-2.5',
        'focus-within:border-saffron transition-colors duration-[var(--duration-fast)]',
        className,
      )}
      role="search"
      aria-label={t('search.role_label')}
    >
      <SearchIcon size={18} strokeWidth={1.5} className="shrink-0 text-ink-muted" aria-hidden />
      <Input
        ref={ref}
        value={local}
        onChange={(e) => setLocal((e.target as HTMLInputElement).value)}
        placeholder={placeholder ?? t('search.placeholder')}
        className="min-w-0 flex-1 border-b-0 px-0 py-0"
        aria-label={t('search.query_label')}
        type="search"
      />
      {loading && (
        <span
          aria-hidden
          className="size-4 shrink-0 animate-spin rounded-full border-2 border-saffron border-t-transparent"
        />
      )}
      {local !== '' && (
        <IconButton
          label={t('search.clear')}
          onClick={() => {
            setLocal('');
            onChange('');
            ref.current?.focus();
          }}
          className="!size-8 shrink-0"
        >
          <X size={16} strokeWidth={1.5} />
        </IconButton>
      )}
      {trailing && (
        <>
          <span aria-hidden className="h-5 w-px shrink-0 bg-cream-line" />
          {trailing}
        </>
      )}
    </div>
  );
}
