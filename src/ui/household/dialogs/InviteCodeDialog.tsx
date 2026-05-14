import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  useToast,
} from '@/ui/primitives';
import { Copy, Link as LinkIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  code: string | null;
};

function buildShareLink(code: string): string {
  if (typeof window === 'undefined') return `/onboarding?code=${code}`;
  return `${window.location.origin}/onboarding?code=${code}`;
}

export function InviteCodeDialog({ open, onOpenChange, code }: Props) {
  const { t } = useTranslation();
  const { push } = useToast();

  const copyCode = async () => {
    if (!code) return;
    await navigator.clipboard.writeText(code);
    push({ variant: 'success', title: t('household_settings.members.code_copied') });
  };

  const copyLink = async () => {
    if (!code) return;
    await navigator.clipboard.writeText(buildShareLink(code));
    push({ variant: 'success', title: t('household_settings.members.link_copied') });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('household_settings.members.invite_generated_title')}</DialogTitle>
          <DialogDescription className="text-base leading-relaxed text-ink-soft">
            {t('household_settings.members.invite_generated_body')}
          </DialogDescription>
        </DialogHeader>
        {code && (
          <div className="rounded-[var(--radius-lg)] border border-dashed border-cream-line bg-paper shadow-press p-4 sm:p-6 text-center">
            <p
              className="font-display text-2xl tracking-[0.25em] sm:text-4xl sm:tracking-[0.4em] text-aubergine break-all"
              aria-label={t('household_settings.members.copy_code')}
            >
              {code}
            </p>
          </div>
        )}
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => void copyLink()}
            leftIcon={<LinkIcon size={16} strokeWidth={1.5} />}
            disabled={!code}
          >
            {t('household_settings.members.copy_link')}
          </Button>
          <Button
            onClick={() => void copyCode()}
            leftIcon={<Copy size={16} strokeWidth={1.5} />}
            disabled={!code}
          >
            {t('household_settings.members.copy_code')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
