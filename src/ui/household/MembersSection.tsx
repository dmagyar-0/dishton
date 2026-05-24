import {
  type HouseholdInvite,
  type HouseholdMember,
  useChangeMemberRole,
  useCreateInvite,
  useHouseholdInvites,
  useHouseholdMembers,
  useRemoveMember,
  useRevokeInvite,
} from '@/lib/queries/households';
import { cn } from '@/ui/cn';
import { Avatar, Badge, Button, Card, IconButton, Skeleton, Tag, useToast } from '@/ui/primitives';
import { ArrowDown, ArrowUp, Mail, UserMinus, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from './dialogs/ConfirmDialog';
import { InviteCodeDialog } from './dialogs/InviteCodeDialog';
import { LeaveOrTransferDialog } from './dialogs/LeaveOrTransferDialog';
import { translateHouseholdError } from './translateError';

type Props = {
  householdId: string;
  selfProfileId: string;
  isOwner: boolean;
  isSolo: boolean;
  onRequestDeleteHousehold: () => void;
};

export function MembersSection({
  householdId,
  selfProfileId,
  isOwner,
  isSolo,
  onRequestDeleteHousehold,
}: Props) {
  const { t, i18n } = useTranslation();
  const { push } = useToast();
  const members = useHouseholdMembers(householdId);
  const invites = useHouseholdInvites(householdId);
  const createInvite = useCreateInvite(householdId);

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        dateStyle: 'medium',
      }),
    [i18n.language],
  );

  const relativeFormatter = useMemo(
    () => new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto', style: 'long' }),
    [i18n.language],
  );

  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);

  const generate = async () => {
    try {
      const code = await createInvite.mutateAsync();
      setInviteCode(code);
      setInviteDialogOpen(true);
    } catch (err) {
      push({
        variant: 'error',
        title: t('household_settings.members.revoke_failed'),
        description: translateHouseholdError(t, err),
      });
    }
  };

  return (
    <div className="space-y-6">
      {!isSolo && (
        <Card className="p-6 space-y-4">
          <div>
            <h2 className="font-display text-xl mb-1">{t('household_settings.members.title')}</h2>
            <p className="text-ink-soft text-sm">{t('household_settings.members.help')}</p>
          </div>

          {members.isLoading && <Skeleton className="h-32" />}

          {members.data && members.data.length === 0 && (
            <p className="text-ink-soft text-sm">{t('household_settings.members.empty')}</p>
          )}

          {members.data && members.data.length > 0 && (
            <ul className="divide-y divide-cream-line">
              {members.data.map((m) => (
                <MemberRow
                  key={m.profile_id}
                  member={m}
                  isSelf={m.profile_id === selfProfileId}
                  isOwner={isOwner}
                  ownerCount={members.data.filter((x) => x.role === 'owner').length}
                  householdId={householdId}
                  onLeave={() => setLeaveOpen(true)}
                  joinedLabel={t('household_settings.members.joined_at', {
                    date: dateFormatter.format(new Date(m.joined_at)),
                  })}
                />
              ))}
            </ul>
          )}
        </Card>
      )}

      <Card className="p-6 space-y-4">
        <div>
          <h2 className="font-display text-xl mb-1">
            {isSolo
              ? t('household_settings.solo.invite_title')
              : t('household_settings.members.invite_title')}
          </h2>
          <p className="text-ink-soft text-sm">
            {isSolo
              ? t('household_settings.solo.invite_help')
              : t('household_settings.members.invite_help')}
          </p>
        </div>
        <div>
          <Button
            type="button"
            onClick={() => void generate()}
            loading={createInvite.isPending}
            leftIcon={<Mail size={16} strokeWidth={1.5} />}
          >
            {t('household_settings.members.generate_invite')}
          </Button>
        </div>

        {invites.data && invites.data.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-cream-line">
            <h3 className="font-body text-sm text-ink-soft uppercase tracking-wide">
              {t('household_settings.members.outstanding_invites')}
            </h3>
            <ul className="space-y-2">
              {invites.data.map((inv) => (
                <InviteRow
                  key={inv.code}
                  invite={inv}
                  householdId={householdId}
                  isOwner={isOwner}
                  expiresLabel={t('household_settings.members.expires_in', {
                    when: formatRelative(relativeFormatter, inv.expires_at),
                  })}
                />
              ))}
            </ul>
          </div>
        )}
      </Card>

      <InviteCodeDialog
        open={inviteDialogOpen}
        onOpenChange={setInviteDialogOpen}
        code={inviteCode}
      />
      {members.data && (
        <LeaveOrTransferDialog
          open={leaveOpen}
          onOpenChange={setLeaveOpen}
          householdId={householdId}
          selfProfileId={selfProfileId}
          members={members.data}
          onRequestDelete={onRequestDeleteHousehold}
        />
      )}
    </div>
  );
}

function MemberRow({
  member,
  isSelf,
  isOwner,
  ownerCount,
  householdId,
  onLeave,
  joinedLabel,
}: {
  member: HouseholdMember;
  isSelf: boolean;
  isOwner: boolean;
  ownerCount: number;
  householdId: string;
  onLeave: () => void;
  joinedLabel: string;
}) {
  const { t } = useTranslation();
  const { push } = useToast();
  const change = useChangeMemberRole(householdId);
  const remove = useRemoveMember(householdId);

  const [confirmKind, setConfirmKind] = useState<'promote' | 'demote' | 'remove' | null>(null);

  const isLastOwner = member.role === 'owner' && ownerCount <= 1;

  const handlePromote = async () => {
    try {
      await change.mutateAsync({ profileId: member.profile_id, role: 'owner' });
      push({
        variant: 'success',
        title: t('household_settings.members.promote_success', {
          name: member.profile.display_name,
        }),
      });
      setConfirmKind(null);
    } catch (err) {
      push({
        variant: 'error',
        title: t('household_settings.members.promote_failed'),
        description: translateHouseholdError(t, err),
      });
    }
  };

  const handleDemote = async () => {
    try {
      await change.mutateAsync({ profileId: member.profile_id, role: 'editor' });
      push({
        variant: 'success',
        title: t('household_settings.members.demote_success', {
          name: member.profile.display_name,
        }),
      });
      setConfirmKind(null);
    } catch (err) {
      push({
        variant: 'error',
        title: t('household_settings.members.demote_failed'),
        description: translateHouseholdError(t, err),
      });
    }
  };

  const handleRemove = async () => {
    try {
      await remove.mutateAsync(member.profile_id);
      push({
        variant: 'success',
        title: t('household_settings.members.remove_success', {
          name: member.profile.display_name,
        }),
      });
      setConfirmKind(null);
    } catch (err) {
      push({
        variant: 'error',
        title: t('household_settings.members.remove_failed'),
        description: translateHouseholdError(t, err),
      });
    }
  };

  const roleLabel =
    member.role === 'owner'
      ? t('household_settings.members.role_owner')
      : t('household_settings.members.role_editor');

  return (
    <li className="flex items-center gap-3 py-3">
      <Avatar
        size={36}
        name={member.profile.display_name}
        src={member.profile.avatar_url ?? undefined}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-body text-ink truncate">
            {member.profile.display_name}
            {isSelf && (
              <span className="ml-2 text-ink-soft text-sm">
                ({t('household_settings.members.you_label')})
              </span>
            )}
          </span>
          <Tag
            variant={member.role === 'owner' ? 'default' : 'secondary'}
            className={cn(
              'uppercase text-xs tracking-wide',
              member.role === 'owner' && 'bg-saffron text-saffron-ink border-saffron',
            )}
          >
            {roleLabel}
          </Tag>
        </div>
        <p className="text-ink-soft text-xs">{joinedLabel}</p>
      </div>

      <div className="flex items-center gap-1">
        {isSelf ? (
          <Button variant="ghost" size="sm" onClick={onLeave}>
            {t('household_settings.members.leave')}
          </Button>
        ) : (
          isOwner && (
            <>
              {member.role === 'editor' && (
                <IconButton
                  variant="ghost"
                  label={t('household_settings.members.promote')}
                  onClick={() => setConfirmKind('promote')}
                  disabled={change.isPending}
                >
                  <ArrowUp size={16} strokeWidth={1.5} />
                </IconButton>
              )}
              {member.role === 'owner' && !isLastOwner && (
                <IconButton
                  variant="ghost"
                  label={t('household_settings.members.demote')}
                  onClick={() => setConfirmKind('demote')}
                  disabled={change.isPending}
                >
                  <ArrowDown size={16} strokeWidth={1.5} />
                </IconButton>
              )}
              <IconButton
                variant="ghost"
                label={t('household_settings.members.remove')}
                onClick={() => setConfirmKind('remove')}
                disabled={remove.isPending}
              >
                <UserMinus size={16} strokeWidth={1.5} />
              </IconButton>
            </>
          )
        )}
      </div>

      <ConfirmDialog
        open={confirmKind === 'promote'}
        onOpenChange={(o) => setConfirmKind(o ? 'promote' : null)}
        title={t('household_settings.members.promote_confirm_title', {
          name: member.profile.display_name,
        })}
        body={t('household_settings.members.promote_confirm_body')}
        confirmLabel={t('household_settings.members.promote_action')}
        variant="primary"
        loading={change.isPending}
        onConfirm={handlePromote}
      />
      <ConfirmDialog
        open={confirmKind === 'demote'}
        onOpenChange={(o) => setConfirmKind(o ? 'demote' : null)}
        title={t('household_settings.members.demote_confirm_title', {
          name: member.profile.display_name,
        })}
        body={t('household_settings.members.demote_confirm_body')}
        confirmLabel={t('household_settings.members.demote_action')}
        variant="secondary"
        loading={change.isPending}
        onConfirm={handleDemote}
      />
      <ConfirmDialog
        open={confirmKind === 'remove'}
        onOpenChange={(o) => setConfirmKind(o ? 'remove' : null)}
        title={t('household_settings.members.remove_confirm_title', {
          name: member.profile.display_name,
        })}
        body={t('household_settings.members.remove_confirm_body', {
          name: member.profile.display_name,
        })}
        confirmLabel={t('household_settings.members.remove_action')}
        variant="destructive"
        loading={remove.isPending}
        onConfirm={handleRemove}
      />
    </li>
  );
}

function InviteRow({
  invite,
  householdId,
  isOwner,
  expiresLabel,
}: {
  invite: HouseholdInvite;
  householdId: string;
  isOwner: boolean;
  expiresLabel: string;
}) {
  const { t } = useTranslation();
  const { push } = useToast();
  const revoke = useRevokeInvite(householdId);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const copyCode = async () => {
    await navigator.clipboard.writeText(invite.code);
    push({ variant: 'success', title: t('household_settings.members.code_copied') });
  };

  const onRevoke = async () => {
    try {
      await revoke.mutateAsync(invite.code);
      push({
        variant: 'success',
        title: t('household_settings.members.revoke_success'),
      });
      setConfirmOpen(false);
    } catch (err) {
      push({
        variant: 'error',
        title: t('household_settings.members.revoke_failed'),
        description: translateHouseholdError(t, err),
      });
    }
  };

  return (
    <li className="flex flex-wrap items-center gap-2 sm:gap-3 rounded-[var(--radius-md)] bg-paper px-3 py-2 border border-cream-line">
      <button
        type="button"
        onClick={() => void copyCode()}
        className="font-display tracking-[0.2em] sm:tracking-[0.25em] text-aubergine"
        title={t('household_settings.members.copy_code')}
      >
        {invite.code}
      </button>
      <Badge variant="outline" className="text-xs whitespace-nowrap">
        {expiresLabel}
      </Badge>
      <div className="flex-1" />
      {isOwner && (
        <IconButton
          variant="ghost"
          label={t('household_settings.members.revoke_invite')}
          onClick={() => setConfirmOpen(true)}
          disabled={revoke.isPending}
        >
          <X size={16} strokeWidth={1.5} />
        </IconButton>
      )}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('household_settings.members.revoke_confirm_title')}
        body={t('household_settings.members.revoke_confirm_body')}
        confirmLabel={t('household_settings.members.revoke_invite_action')}
        variant="destructive"
        loading={revoke.isPending}
        onConfirm={onRevoke}
      />
    </li>
  );
}

function formatRelative(rtf: Intl.RelativeTimeFormat, isoDate: string): string {
  const target = new Date(isoDate).getTime();
  const diffMs = target - Date.now();
  const minutes = Math.round(diffMs / 60000);
  if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour');
  const days = Math.round(hours / 24);
  return rtf.format(days, 'day');
}
