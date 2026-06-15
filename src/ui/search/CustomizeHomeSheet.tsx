import { MAX_HOME_CATEGORIES } from '@/domain/default-tags';
import { cn } from '@/ui/cn';
import {
  Button,
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/ui/primitives';
import { Check, Lock, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ALL_CATEGORY, categoryIcon, categoryLabel } from './categoryIcons';

export type CustomizeHomeSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The household's full category library (allowed_tags), excluding "All". */
  library: string[];
  /** The current Home set (primary_tags), excluding the implicit "All". */
  homeTags: string[];
  onSave: (next: string[]) => void;
  saving?: boolean;
};

type TileState = 'locked' | 'on' | 'off' | 'blocked';

function LibraryTile({
  id,
  state,
  onToggle,
}: {
  id: string;
  state: TileState;
  onToggle?: () => void;
}) {
  const Icon = categoryIcon(id);
  const BadgeIcon = state === 'locked' ? Lock : state === 'on' ? Check : Plus;
  const selected = state === 'locked' || state === 'on';
  const disabled = state === 'locked' || state === 'blocked';
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        'group/lib flex cursor-pointer flex-col items-center gap-1.5 bg-transparent p-0',
        state === 'blocked' && 'cursor-not-allowed opacity-[0.38]',
        state === 'locked' && 'cursor-default',
      )}
    >
      <span
        className={cn(
          'relative flex size-14 items-center justify-center rounded-[17px] border',
          'transition-[transform,background-color,border-color] duration-[var(--duration-fast)]',
          'ease-[var(--ease-paper)]',
          state !== 'blocked' && state !== 'locked' && 'group-hover/lib:-translate-y-0.5',
          selected
            ? 'border-saffron bg-[color-mix(in_srgb,var(--color-saffron)_15%,var(--color-paper))] text-saffron-ink'
            : 'border-cream-line bg-paper-2 text-ink-soft',
        )}
      >
        <Icon size={22} strokeWidth={1.5} aria-hidden="true" />
        <span
          className={cn(
            'absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border',
            selected
              ? 'border-saffron bg-saffron text-saffron-ink'
              : 'border-cream-line bg-paper text-ink-muted',
          )}
        >
          <BadgeIcon size={state === 'locked' ? 11 : 12} strokeWidth={2.2} aria-hidden="true" />
        </span>
      </span>
      <span
        className={cn(
          'max-w-16 truncate text-[0.7rem]',
          selected ? 'font-semibold text-ink' : 'text-ink-soft',
        )}
      >
        {categoryLabel(id)}
      </span>
    </button>
  );
}

/**
 * Bottom sheet to personalise which meal categories lead the Home screen. Edits
 * the household's `primary_tags` (persisted by the caller). "All" is always
 * present and locked, so at most MAX_HOME_CATEGORIES - 1 categories can be
 * stored; once full, unpicked tiles are blocked until a slot is freed.
 */
export function CustomizeHomeSheet({
  open,
  onOpenChange,
  library,
  homeTags,
  onSave,
  saving,
}: CustomizeHomeSheetProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string[]>(homeTags);

  // Reset the working set every time the sheet opens so a cancelled edit (close
  // without Done) is discarded.
  useEffect(() => {
    if (open) setDraft(homeTags);
  }, [open, homeTags]);

  const used = draft.length + 1; // +1 for the implicit, always-on "All".
  const atMax = used >= MAX_HOME_CATEGORIES;

  const toggle = (tag: string) =>
    setDraft((prev) =>
      prev.includes(tag)
        ? prev.filter((x) => x !== tag)
        : prev.length + 1 >= MAX_HOME_CATEGORIES
          ? prev
          : [...prev, tag],
    );

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        side="bottom"
        closeLabel={t('common.close')}
        className="mx-auto max-h-[88vh] max-w-[460px] gap-0 p-0"
      >
        <span
          aria-hidden="true"
          className="mx-auto mt-2.5 mb-0.5 h-1 w-10 shrink-0 rounded-full bg-cream-line"
        />
        <DrawerHeader className="shrink-0 px-5 pt-2 pb-3">
          <DrawerTitle className="text-xl">{t('search.customize_title')}</DrawerTitle>
          <DrawerDescription>{t('search.customize_help')}</DrawerDescription>
        </DrawerHeader>

        <div className="flex-1 overflow-y-auto px-5">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <span className="font-mono text-xs tracking-[0.18em] text-saffron uppercase">
              {t('search.categories_label')} ·{' '}
              <span className="text-ink-muted">
                {used} / {MAX_HOME_CATEGORIES}
              </span>
            </span>
            <span className="text-[0.72rem] text-ink-muted">
              {atMax ? t('search.limit_reached') : t('search.tap_to_toggle')}
            </span>
          </div>

          <div className="grid grid-cols-4 gap-x-[0.65rem] gap-y-[0.9rem] pb-1">
            <LibraryTile id={ALL_CATEGORY} state="locked" />
            {library.map((tag) => {
              const on = draft.includes(tag);
              const state: TileState = on ? 'on' : atMax ? 'blocked' : 'off';
              return <LibraryTile key={tag} id={tag} state={state} onToggle={() => toggle(tag)} />;
            })}
          </div>
        </div>

        <div className="shrink-0 px-5 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <Button className="w-full" onClick={() => onSave(draft)} disabled={saving}>
            {t('search.customize_done')}
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
