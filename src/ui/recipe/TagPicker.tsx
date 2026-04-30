import { cn } from '@/ui/cn';
import { Tag } from '@/ui/primitives/Badge';
import { IconButton } from '@/ui/primitives/IconButton';
import { Input } from '@/ui/primitives/Input';
import { X } from 'lucide-react';
import { useState } from 'react';

export type TagPickerProps = {
  value: string[];
  onChange: (value: string[]) => void;
  suggestions?: string[];
  className?: string;
};

const MAX = 40;

function normalize(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  if (s.length === 0 || s.length > MAX) return null;
  return s;
}

export function TagPicker({ value, onChange, suggestions = [], className }: TagPickerProps) {
  const [draft, setDraft] = useState('');

  const submit = (raw: string) => {
    const n = normalize(raw);
    if (n === null) return;
    if (value.includes(n)) return;
    onChange([...value, n]);
    setDraft('');
  };

  const remove = (tag: string) => onChange(value.filter((t) => t !== tag));

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex flex-wrap gap-1.5">
        {value.map((tag) => (
          <Tag key={tag} variant="secondary" className="inline-flex items-center gap-1">
            {tag}
            <IconButton label={`Remove ${tag}`} className="!size-5" onClick={() => remove(tag)}>
              <X size={12} strokeWidth={1.5} />
            </IconButton>
          </Tag>
        ))}
      </div>
      <Input
        value={draft}
        onChange={(e) => setDraft((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            submit(draft);
          } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
            const last = value[value.length - 1];
            if (last) remove(last);
          }
        }}
        placeholder="Add a tag, then press Enter"
        list="tag-suggestions"
      />
      {suggestions.length > 0 && (
        <datalist id="tag-suggestions">
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
    </div>
  );
}
