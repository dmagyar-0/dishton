import { type HouseholdSettings, useUpdateHouseholdName } from '@/lib/queries/households';
import { Button, Card, Input, useToast } from '@/ui/primitives';
import { Skeleton } from '@/ui/primitives/Skeleton';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DeleteHouseholdDialog } from './dialogs/DeleteHouseholdDialog';
import { translateHouseholdError } from './translateError';

type Props = {
  household: HouseholdSettings | undefined;
  householdId: string;
  isLoading: boolean;
  isOwner: boolean;
};

export function GeneralSection({ household, householdId, isLoading, isOwner }: Props) {
  const { t } = useTranslation();
  const { push } = useToast();
  const update = useUpdateHouseholdName(householdId);

  const [draft, setDraft] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    if (household?.name) setDraft(household.name);
  }, [household?.name]);

  if (isLoading || !household) {
    return (
      <Card className="p-6">
        <Skeleton className="h-20" />
      </Card>
    );
  }

  const dirty = draft.trim().length > 0 && draft !== household.name;

  const saveName = async () => {
    try {
      await update.mutateAsync(draft.trim());
      push({ variant: 'success', title: t('household_settings.general.name_saved') });
    } catch (err) {
      push({
        variant: 'error',
        title: t('household_settings.general.name_save_failed'),
        description: translateHouseholdError(t, err),
      });
    }
  };

  return (
    <div className="space-y-6">
      <Card className="p-6 space-y-4">
        <div>
          <h2 className="font-display text-xl mb-1">{t('household_settings.general.title')}</h2>
        </div>
        <div className="space-y-2">
          <label className="font-body text-sm text-ink-soft" htmlFor="household-name-input">
            {t('household_settings.general.name_label')}
          </label>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <Input
                id="household-name-input"
                value={draft}
                onChange={(e) => setDraft((e.target as HTMLInputElement).value)}
                disabled={!isOwner || update.isPending}
                maxLength={80}
              />
            </div>
            {isOwner && (
              <Button
                type="button"
                onClick={() => void saveName()}
                disabled={!dirty}
                loading={update.isPending}
              >
                {t('household_settings.general.name_save')}
              </Button>
            )}
          </div>
          {!isOwner && (
            <p className="text-ink-soft text-sm">{t('household_settings.read_only_notice')}</p>
          )}
        </div>
      </Card>

      {isOwner && (
        <Card className="p-6 space-y-4 border-pomegranate/30">
          <div>
            <h2 className="font-display text-xl mb-1 text-pomegranate">
              {t('household_settings.general.danger_title')}
            </h2>
            <p className="text-ink-soft text-sm">{t('household_settings.general.danger_body')}</p>
          </div>
          <div>
            <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
              {t('household_settings.general.delete_title')}
            </Button>
          </div>
          <DeleteHouseholdDialog
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            householdId={householdId}
            householdName={household.name}
          />
        </Card>
      )}
    </div>
  );
}
