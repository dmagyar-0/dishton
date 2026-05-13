import { DEFAULT_HOUSEHOLD_TAGS, normalizeTag } from '@/domain/default-tags';
import { type HouseholdSettings, useUpdateHouseholdAllowedTags } from '@/lib/queries/households';
import { Button, Card, IconButton, Input, Skeleton, Tag, useToast } from '@/ui/primitives';
import { X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

type Props = {
  household: HouseholdSettings | undefined;
  householdId: string;
  isLoading: boolean;
  isOwner: boolean;
};

export function TagsSection({ household, householdId, isLoading, isOwner }: Props) {
  const { t } = useTranslation();
  const { push } = useToast();
  const update = useUpdateHouseholdAllowedTags(householdId);

  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const tags = household?.allowed_tags ?? [];
  const tagSet = useMemo(() => new Set(tags), [tags]);

  const persist = async (next: string[]): Promise<void> => {
    try {
      await update.mutateAsync(next);
      push({ variant: 'success', title: t('household_settings.tags_saved') });
    } catch {
      push({ variant: 'error', title: t('household_settings.tags_save_failed') });
    }
  };

  const addTag = async (): Promise<void> => {
    const normalized = normalizeTag(draft);
    if (normalized === null) {
      setError(t('household_settings.tag_invalid'));
      return;
    }
    if (tagSet.has(normalized)) {
      setError(t('household_settings.tag_exists'));
      return;
    }
    setError(null);
    setDraft('');
    await persist([...tags, normalized]);
  };

  const removeTag = async (tag: string): Promise<void> => {
    await persist(tags.filter((x) => x !== tag));
  };

  const resetToDefaults = async (): Promise<void> => {
    await persist([...DEFAULT_HOUSEHOLD_TAGS]);
  };

  return (
    <Card className="p-6 space-y-4">
      <div>
        <h2 className="font-display text-xl mb-1">{t('household_settings.tags_title')}</h2>
        <p className="text-ink-soft text-sm">{t('household_settings.tags_help')}</p>
      </div>

      {isLoading && <Skeleton className="h-20" />}

      {household && (
        <>
          <div className="flex flex-wrap gap-1.5" aria-label={t('household_settings.tags_title')}>
            {tags.length === 0 && (
              <p className="text-ink-soft text-sm">{t('household_settings.tags_empty')}</p>
            )}
            {tags.map((tag) => (
              <Tag key={tag} variant="secondary" className="inline-flex items-center gap-1">
                {tag}
                {isOwner && (
                  <IconButton
                    label={t('household_settings.remove_tag', { tag })}
                    className="!size-5"
                    onClick={() => void removeTag(tag)}
                    disabled={update.isPending}
                  >
                    <X size={12} strokeWidth={1.5} />
                  </IconButton>
                )}
              </Tag>
            ))}
          </div>

          {isOwner ? (
            <>
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <Input
                    value={draft}
                    onChange={(e) => setDraft((e.target as HTMLInputElement).value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void addTag();
                      }
                    }}
                    placeholder={t('household_settings.add_tag_placeholder')}
                    disabled={update.isPending}
                  />
                </div>
                <Button
                  type="button"
                  onClick={() => void addTag()}
                  disabled={update.isPending || draft.trim().length === 0}
                >
                  {t('household_settings.add')}
                </Button>
              </div>
              {error && <p className="text-pomegranate text-sm">{error}</p>}

              <div className="pt-2 border-t border-cream-line">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => void resetToDefaults()}
                  disabled={update.isPending}
                >
                  {t('household_settings.reset_defaults')}
                </Button>
              </div>
            </>
          ) : (
            <p className="text-ink-soft text-sm">{t('household_settings.read_only_notice')}</p>
          )}
        </>
      )}
    </Card>
  );
}
