import { cn } from '@/ui/cn';
import { IconButton } from '@/ui/primitives/IconButton';
import { Input } from '@/ui/primitives/Input';
import { Search as SearchIcon, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

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
  placeholder = 'Search recipes',
}: SearchBarProps) {
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
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || (t as HTMLElement)?.isContentEditable) return;
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
      aria-label="Recipes search"
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
        placeholder={placeholder}
        className="pl-8 pr-10 w-full"
        aria-label="Search query"
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
          label="Clear search"
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
