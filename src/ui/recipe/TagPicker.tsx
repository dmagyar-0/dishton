import { cn } from '@/ui/cn';
import { Tag } from '@/ui/primitives/Badge';
import { X } from 'lucide-react';

export type TagPickerProps = {
  value: string[];
  onChange: (value: string[]) => void;
  allowedTags: readonly string[];
  className?: string;
};

// Strict chip picker. Tags can only be toggled on if they appear in the
// household-defined allowedTags list — see src/routes/h/$householdId/settings.tsx
// for where that list is managed. Existing recipes may still carry "off-list"
// tags from before the whitelist was introduced or from a tag being removed
// after the recipe was saved; those render as removable-only chips at the top
// so the user can clear them but never re-add a non-whitelist tag.
export function TagPicker({ value, onChange, allowedTags, className }: TagPickerProps) {
  const allowedSet = new Set(allowedTags);
  const offList = value.filter((t) => !allowedSet.has(t));
  const selected = new Set(value);

  const toggle = (tag: string): void => {
    if (selected.has(tag)) {
      onChange(value.filter((t) => t !== tag));
    } else {
      onChange([...value, tag]);
    }
  };

  const remove = (tag: string): void => {
    onChange(value.filter((t) => t !== tag));
  };

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {offList.length > 0 && (
        <div
          className="flex flex-wrap gap-1.5"
          aria-label="Tags from before the household whitelist"
        >
          {offList.map((tag) => (
            <Tag
              key={`off-${tag}`}
              variant="outline"
              className="inline-flex items-center gap-1 opacity-70"
            >
              <span className="line-through decoration-ink-muted/60">{tag}</span>
              <button
                type="button"
                aria-label={`Remove ${tag}`}
                className="ml-0.5 inline-flex size-4 items-center justify-center rounded-full hover:bg-paper-2"
                onClick={() => remove(tag)}
              >
                <X size={12} strokeWidth={1.5} />
              </button>
            </Tag>
          ))}
        </div>
      )}

      {allowedTags.length === 0 ? (
        <p className="text-sm text-ink-soft">
          No tags configured for this household yet. Add some in household settings.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Recipe tags">
          {allowedTags.map((tag) => {
            const isOn = selected.has(tag);
            return (
              <button
                key={tag}
                type="button"
                aria-pressed={isOn}
                onClick={() => toggle(tag)}
                className={cn(
                  'inline-flex items-center gap-1 px-2 py-0.5',
                  'rounded-[var(--radius-pill)] border',
                  'font-body text-xs font-medium',
                  'transition-colors duration-[var(--duration-fast)]',
                  isOn
                    ? 'bg-sage text-sage-ink border-sage'
                    : 'bg-transparent text-ink border-cream-line hover:bg-paper-2',
                )}
              >
                {tag}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
