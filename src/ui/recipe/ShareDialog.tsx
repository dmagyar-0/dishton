import { sharePath } from '@/domain';
import { useDisableShare, useEnableShare, useRecipeShare } from '@/lib/queries/shares';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/ui/primitives/Dialog';
import { Switch } from '@/ui/primitives/Switch';
import { useToast } from '@/ui/primitives/Toast';
import { Copy, Share2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export type ShareDialogProps = { recipeId: string };

export function ShareDialog({ recipeId }: ShareDialogProps) {
  const { t } = useTranslation();
  const { push } = useToast();
  const shareQ = useRecipeShare(recipeId);
  const enable = useEnableShare(recipeId);
  const disable = useDisableShare(recipeId);

  const token = shareQ.data?.token ?? null;
  const shared = token != null;
  const shareUrl = token ? `${window.location.origin}${sharePath(token)}` : null;
  const busy = shareQ.isLoading || enable.isPending || disable.isPending;

  const onToggle = (next: boolean) => {
    const opts = {
      onError: () => push({ variant: 'error', title: t('share.share_failed') }),
    } as const;
    if (next) enable.mutate(undefined, opts);
    else disable.mutate(undefined, opts);
  };

  const onCopy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      push({ variant: 'success', title: t('share.link_copied') });
    } catch {
      push({ variant: 'error', title: t('share.share_failed') });
    }
  };

  return (
    <Dialog>
      <DialogTrigger
        className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] border border-cream-line bg-paper-2 px-3 text-sm text-ink-soft transition-colors duration-[var(--duration-fast)] hover:bg-paper hover:text-ink"
        aria-label={t('share.action')}
      >
        <Share2 size={14} strokeWidth={1.5} aria-hidden="true" />
        <span>{t('share.action')}</span>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('share.dialog_title')}</DialogTitle>
          <DialogDescription>{t('share.dialog_body')}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between gap-4">
          <span className="font-body text-sm text-ink">{t('share.toggle_label')}</span>
          <Switch
            checked={shared}
            disabled={busy}
            label={t('share.toggle_label')}
            onCheckedChange={onToggle}
          />
        </div>
        {shareUrl && (
          <div className="mt-4 space-y-2">
            <p className="break-all rounded-[var(--radius-md)] border border-cream-line bg-paper px-3 py-2 font-mono text-xs text-ink-soft">
              {shareUrl}
            </p>
            <button
              type="button"
              onClick={() => void onCopy()}
              className="inline-flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] border border-cream-line bg-paper-2 px-3 text-sm text-ink transition-colors duration-[var(--duration-fast)] hover:bg-paper"
            >
              <Copy size={14} strokeWidth={1.5} aria-hidden="true" />
              {t('share.copy_link')}
            </button>
            <p className="font-body text-xs text-ink-muted">{t('share.regenerate_hint')}</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
