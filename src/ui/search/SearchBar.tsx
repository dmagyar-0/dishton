import { isTypingIntoInput } from '@/lib/shortcuts';
import { cn } from '@/ui/cn';
import { IconButton } from '@/ui/primitives/IconButton';
import { Input } from '@/ui/primitives/Input';
import { Search as SearchIcon, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export type SearchBarProps = {
  value: string;
  onChange: (value: string) => void;
  loading?: boolean;
  className?: string;
  placeholder?: string;
};

export function SearchBar({
  value,
  onChange,
  loading = false,
  className,
  placeholder,
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
      className={cn('relative flex items-center gap-2', className)}
      role="search"
      aria-label={t('search.role_label')}
    >
      <SearchIcon
        size={18}
        className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-muted pointer-events-none"
        strokeWidth={1.5}
      />
      <Input
        ref={ref}
        value={local}
        onChange={(e) => setLocal((e.target as HTMLInputElement).value)}
        placeholder={placeholder ?? t('search.placeholder')}
        className="pl-8 pr-10 w-full"
        aria-label={t('search.query_label')}
        type="search"
      />
      {loading && (
        <span
          aria-hidden
          className="absolute right-10 top-1/2 -translate-y-1/2 size-4 border-2 border-saffron border-t-transparent rounded-full animate-spin"
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
          className="!absolute right-1 top-1/2 -translate-y-1/2 !size-8"
        >
          <X size={16} strokeWidth={1.5} />
        </IconButton>
      )}
    </div>
  );
}
