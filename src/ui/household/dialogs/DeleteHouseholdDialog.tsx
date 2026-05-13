import { useDeleteHousehold } from '@/lib/queries/households';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  useToast,
} from '@/ui/primitives';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { translateHouseholdError } from '../translateError';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  householdId: string;
  householdName: string;
};

export function DeleteHouseholdDialog({ open, onOpenChange, householdId, householdName }: Props) {
  const { t } = useTranslation();
  const { push } = useToast();
  const nav = useNavigate();
  const del = useDeleteHousehold();
  const [confirm, setConfirm] = useState('');

  useEffect(() => {
    if (!open) setConfirm('');
  }, [open]);

  const confirmMatches = confirm.trim() === householdName;

  const onConfirm = async () => {
    try {
      await del.mutateAsync(householdId);
      onOpenChange(false);
      push({
        variant: 'success',
        title: t('household_settings.general.delete_success'),
      });
      await nav({ to: '/' });
    } catch (err) {
      push({
        variant: 'error',
        title: t('household_settings.general.delete_failed'),
        description: translateHouseholdError(t, err),
      });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (del.isPending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('household_settings.general.delete_dialog_title')}</DialogTitle>
          <DialogDescription className="text-base leading-relaxed text-ink-soft">
            {t('household_settings.general.delete_dialog_body', { name: householdName })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label className="font-body text-sm text-ink-soft" htmlFor="delete-household-confirm">
            {t('household_settings.general.delete_confirm_label')}
          </label>
          <Input
            id="delete-household-confirm"
            autoComplete="off"
            value={confirm}
            onChange={(e) => setConfirm((e.target as HTMLInputElement).value)}
            placeholder={householdName}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={del.isPending}>
            {t('household_settings.common.cancel')}
          </Button>
          <Button
            variant="destructive"
            onClick={() => void onConfirm()}
            loading={del.isPending}
            disabled={!confirmMatches || del.isPending}
          >
            {t('household_settings.general.delete_confirm_action')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
