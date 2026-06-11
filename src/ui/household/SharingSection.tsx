import {
  type FollowedHousehold,
  type HouseholdFollowCode,
  useCreateFollowCode,
  useFollowedHouseholds,
  useFollowersOfHousehold,
  useHouseholdFollowCodes,
  useRevokeFollowCode,
  useUnfollow,
} from '@/lib/queries/households';
import { cn } from '@/ui/cn';
import { Badge, Button, Card, IconButton, Skeleton, useToast } from '@/ui/primitives';
import { Link } from '@tanstack/react-router';
import { Share2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from './dialogs/ConfirmDialog';
import { translateHouseholdError } from './translateError';

type Props = {
  householdId: string;
  isOwner: boolean;
};

export function SharingSection({ householdId, isOwner }: Props) {
  const { t, i18n } = useTranslation();
  const { push } = useToast();

  const codes = useHouseholdFollowCodes(householdId);
  const followed = useFollowedHouseholds(householdId);
  const followers = useFollowersOfHousehold(householdId);
  const create = useCreateFollowCode(householdId);

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        dateStyle: 'medium',
      }),
    [i18n.language],
  );

  const generate = async () => {
    try {
      await create.mutateAsync();
    } catch (err) {
      push({
        variant: 'error',
        title: t('household_settings.sharing.revoke_failed'),
        description: translateHouseholdError(t, err),
      });
    }
  };

  return (
    <div className="space-y-6">
      <Card className="p-6 space-y-4">
        <div>
          <h2 className="font-display text-xl mb-1">{t('household_settings.sharing.title')}</h2>
          <p className="text-ink-soft text-sm">{t('household_settings.sharing.help')}</p>
        </div>

        {!isOwner && (
          <p className="text-ink-soft text-sm">
            {t('household_settings.sharing.owner_only_notice')}
          </p>
        )}

        {isOwner && (
          <div>
            <Button
              type="button"
              onClick={() => void generate()}
              loading={create.isPending}
              leftIcon={<Share2 size={16} strokeWidth={1.5} />}
            >
              {t('household_settings.sharing.generate_follow_code')}
            </Button>
          </div>
        )}

        {codes.data && codes.data.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-cream-line">
            <h3 className="font-body text-sm text-ink-soft uppercase tracking-wide">
              {t('household_settings.sharing.outstanding_codes')}
            </h3>
            <p className="text-ink-soft text-sm">{t('household_settings.sharing.redeem_hint')}</p>
            <ul className="space-y-3">
              {codes.data.map((code) => (
                <FollowCodeCard
                  key={code.code}
                  code={code}
                  householdId={householdId}
                  isOwner={isOwner}
                />
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card className="p-6 space-y-4">
        <h2 className="font-display text-xl mb-1">
          {t('household_settings.sharing.followed_title')}
        </h2>
        {followed.isLoading && <Skeleton className="h-12" />}
        {followed.data && followed.data.length === 0 && (
          <p className="text-ink-soft text-sm">{t('household_settings.sharing.followed_empty')}</p>
        )}
        {followed.data && followed.data.length > 0 && (
          <ul className="divide-y divide-cream-line">
            {followed.data.map((f) => (
              <FollowedRow
                key={f.followed_household_id}
                followed={f}
                householdId={householdId}
                isOwner={isOwner}
                followedAtLabel={t('following.followed_at', {
                  date: dateFormatter.format(new Date(f.created_at)),
                })}
              />
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-6 space-y-2">
        <h2 className="font-display text-xl mb-1">
          {t('household_settings.sharing.followers_title')}
        </h2>
        {followers.isLoading && <Skeleton className="h-12" />}
        {followers.data && followers.data.length === 0 && (
          <p className="text-ink-soft text-sm">{t('household_settings.sharing.followers_empty')}</p>
        )}
        {followers.data && followers.data.length > 0 && (
          <ul className="space-y-1">
            {followers.data.map((f) => (
              <li key={f.follower_household_id} className="flex items-center justify-between py-2">
                <span className="font-body text-ink">{f.household.name}</span>
                <span className="text-ink-soft text-xs">
                  {dateFormatter.format(new Date(f.created_at))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function FollowCodeCard({
  code,
  householdId,
  isOwner,
}: {
  code: HouseholdFollowCode;
  householdId: string;
  isOwner: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { push } = useToast();
  const revoke = useRevokeFollowCode(householdId);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const rtf = useMemo(
    () => new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto', style: 'long' }),
    [i18n.language],
  );

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code.code);
      push({ variant: 'success', title: t('household_settings.sharing.code_copied') });
    } catch {
      push({ variant: 'error', title: t('household_settings.sharing.copy_failed') });
    }
  };

  const onRevoke = async () => {
    try {
      await revoke.mutateAsync(code.code);
      push({
        variant: 'success',
        title: t('household_settings.sharing.revoke_success'),
      });
      setConfirmOpen(false);
    } catch (err) {
      push({
        variant: 'error',
        title: t('household_settings.sharing.revoke_failed'),
        description: translateHouseholdError(t, err),
      });
    }
  };

  const expiresIn = formatRelative(rtf, code.expires_at);

  return (
    <li
      className={cn(
        'relative rounded-[var(--radius-lg)] bg-paper px-4 py-3',
        'border border-dashed border-cream-line shadow-press',
        'transition-transform duration-[var(--duration-fast)]',
        'hover:-rotate-[0.25deg]',
      )}
    >
      <button
        type="button"
        onClick={() => void copyCode()}
        className="block w-full text-left"
        title={t('household_settings.sharing.copy_code')}
      >
        <span className="block break-all pr-8 font-display tracking-[0.15em] text-aubergine text-base sm:text-lg sm:tracking-[0.2em]">
          {code.code}
        </span>
        <span className="mt-2 flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="text-xs">
            {t('household_settings.members.expires_in', { when: expiresIn })}
          </Badge>
          <span className="text-ink-soft text-xs">
            {t('household_settings.sharing.tap_to_copy')}
          </span>
        </span>
      </button>
      {isOwner && (
        <IconButton
          variant="ghost"
          label={t('household_settings.sharing.revoke')}
          onClick={() => setConfirmOpen(true)}
          disabled={revoke.isPending}
          className="absolute right-2 top-2"
        >
          <X size={16} strokeWidth={1.5} />
        </IconButton>
      )}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('household_settings.sharing.revoke_confirm_title')}
        body={t('household_settings.sharing.revoke_confirm_body')}
        confirmLabel={t('household_settings.sharing.revoke')}
        variant="destructive"
        loading={revoke.isPending}
        onConfirm={onRevoke}
      />
    </li>
  );
}

function FollowedRow({
  followed,
  householdId,
  isOwner,
  followedAtLabel,
}: {
  followed: FollowedHousehold;
  householdId: string;
  isOwner: boolean;
  followedAtLabel: string;
}) {
  const { t } = useTranslation();
  const { push } = useToast();
  const unfollow = useUnfollow(householdId);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const onUnfollow = async () => {
    try {
      await unfollow.mutateAsync(followed.followed_household_id);
      push({
        variant: 'success',
        title: t('household_settings.sharing.unfollow_success'),
      });
      setConfirmOpen(false);
    } catch (err) {
      push({
        variant: 'error',
        title: t('household_settings.sharing.unfollow_failed'),
        description: translateHouseholdError(t, err),
      });
    }
  };

  return (
    <li className="flex items-center justify-between py-3">
      <div>
        <Link
          to="/h/$householdId"
          params={{ householdId: followed.followed_household_id }}
          className="font-body text-ink hover:underline"
        >
          {followed.household.name}
        </Link>
        <p className="text-ink-soft text-xs">{followedAtLabel}</p>
      </div>
      {isOwner && (
        <>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfirmOpen(true)}
            disabled={unfollow.isPending}
          >
            {t('household_settings.sharing.unfollow')}
          </Button>
          <ConfirmDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title={t('household_settings.sharing.unfollow_confirm_title', {
              name: followed.household.name,
            })}
            body={t('household_settings.sharing.unfollow_confirm_body')}
            confirmLabel={t('household_settings.sharing.unfollow_action')}
            variant="destructive"
            loading={unfollow.isPending}
            onConfirm={onUnfollow}
          />
        </>
      )}
    </li>
  );
}

function formatRelative(rtf: Intl.RelativeTimeFormat, isoDate: string): string {
  const target = new Date(isoDate).getTime();
  const diffMs = target - Date.now();
  const hours = Math.round(diffMs / (60 * 60 * 1000));
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour');
  const days = Math.round(hours / 24);
  return rtf.format(days, 'day');
}
