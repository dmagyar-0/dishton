import {
  type HouseholdMember,
  useLeaveHousehold,
  useLeaveHouseholdWithRecipes,
  useTransferOwnership,
} from '@/lib/queries/households';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
  useToast,
} from '@/ui/primitives';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { householdErrorCode, translateHouseholdError } from '../translateError';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  householdId: string;
  selfProfileId: string;
  members: HouseholdMember[];
  onRequestDelete: () => void;
};

// Two-stage dialog: first asks to confirm leaving. If the RPC returns
// `last_owner`, the same dialog swaps into a "transfer ownership or delete the
// household" recovery view.
export function LeaveOrTransferDialog({
  open,
  onOpenChange,
  householdId,
  selfProfileId,
  members,
  onRequestDelete,
}: Props) {
  const { t } = useTranslation();
  const { push } = useToast();
  const nav = useNavigate();
  const leave = useLeaveHousehold();
  const leaveWithRecipes = useLeaveHouseholdWithRecipes();
  const transfer = useTransferOwnership(householdId);

  const [stage, setStage] = useState<'leave' | 'transfer'>('leave');
  const [pickedProfile, setPickedProfile] = useState<string>('');

  const otherMembers = useMemo(
    () => members.filter((m) => m.profile_id !== selfProfileId),
    [members, selfProfileId],
  );

  useEffect(() => {
    if (!open) {
      setStage('leave');
      setPickedProfile('');
    }
  }, [open]);

  const isPending = leave.isPending || transfer.isPending || leaveWithRecipes.isPending;

  const performLeave = async () => {
    try {
      await leave.mutateAsync(householdId);
      onOpenChange(false);
      push({
        variant: 'success',
        title: t('household_settings.members.leave_success'),
      });
      await nav({ to: '/' });
    } catch (err) {
      if (householdErrorCode(err) === 'last_owner') {
        setStage('transfer');
        return;
      }
      push({
        variant: 'error',
        title: t('household_settings.members.leave_failed'),
        description: translateHouseholdError(t, err),
      });
    }
  };

  // Symmetric counterpart to the merge-on-redeem behaviour. The user
  // leaves the shared household but takes the recipes they authored
  // with them into a fresh (or existing) personal household, where they
  // can continue solo.
  const performLeaveKeepRecipes = async () => {
    try {
      const newPersonalId = await leaveWithRecipes.mutateAsync(householdId);
      onOpenChange(false);
      push({
        variant: 'success',
        title: t('household_settings.members.leave_kept_success'),
      });
      await nav({
        to: '/h/$householdId',
        params: { householdId: newPersonalId },
      });
    } catch (err) {
      if (householdErrorCode(err) === 'last_owner') {
        setStage('transfer');
        return;
      }
      push({
        variant: 'error',
        title: t('household_settings.members.leave_failed'),
        description: translateHouseholdError(t, err),
      });
    }
  };

  const performTransferThenLeave = async () => {
    if (!pickedProfile) return;
    try {
      await transfer.mutateAsync(pickedProfile);
      push({
        variant: 'success',
        title: t('household_settings.members.transfer_success'),
      });
      // Now that the caller is an editor, leaving is permitted.
      await leave.mutateAsync(householdId);
      onOpenChange(false);
      push({
        variant: 'success',
        title: t('household_settings.members.leave_success'),
      });
      await nav({ to: '/' });
    } catch (err) {
      push({
        variant: 'error',
        title: t('household_settings.members.transfer_failed'),
        description: translateHouseholdError(t, err),
      });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (isPending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent>
        {stage === 'leave' ? (
          <>
            <DialogHeader>
              <DialogTitle>{t('household_settings.members.leave_confirm_title')}</DialogTitle>
              <DialogDescription className="text-base leading-relaxed text-ink-soft">
                {t('household_settings.members.leave_confirm_body_v2')}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex-col sm:flex-row gap-2 sm:gap-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
                {t('household_settings.common.cancel')}
              </Button>
              <Button
                variant="secondary"
                onClick={() => void performLeave()}
                loading={leave.isPending}
                disabled={isPending}
              >
                {t('household_settings.members.leave_no_recipes_action')}
              </Button>
              <Button
                onClick={() => void performLeaveKeepRecipes()}
                loading={leaveWithRecipes.isPending}
                disabled={isPending}
              >
                {t('household_settings.members.leave_keep_recipes_action')}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t('household_settings.members.last_owner_title')}</DialogTitle>
              <DialogDescription className="text-base leading-relaxed text-ink-soft">
                {t('household_settings.members.last_owner_body')}
              </DialogDescription>
            </DialogHeader>

            {otherMembers.length > 0 ? (
              <div className="space-y-2">
                <label className="font-body text-sm text-ink-soft" htmlFor="transfer-target">
                  {t('household_settings.members.transfer_label')}
                </label>
                <Select
                  id="transfer-target"
                  value={pickedProfile}
                  onChange={(e) => setPickedProfile(e.target.value)}
                  disabled={isPending}
                >
                  <option value="">—</option>
                  {otherMembers.map((m) => (
                    <option key={m.profile_id} value={m.profile_id}>
                      {m.profile.display_name}
                    </option>
                  ))}
                </Select>
              </div>
            ) : (
              <p className="text-ink-soft text-sm">
                {t('household_settings.members.no_editors_to_promote')}
              </p>
            )}

            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => {
                  onOpenChange(false);
                  onRequestDelete();
                }}
                disabled={isPending}
              >
                {t('household_settings.members.delete_instead')}
              </Button>
              <Button
                onClick={() => void performTransferThenLeave()}
                loading={isPending}
                disabled={isPending || !pickedProfile}
              >
                {t('household_settings.members.transfer_action')}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
