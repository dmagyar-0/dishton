import { cn } from '@/ui/cn';
import { Link2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// Corner marker on a home-page card that is a live link to a followed
// household's recipe. Sits top-left so it never collides with the top-right
// remove/delete overlay.
export function RecipeLinkBadge({ className }: { className?: string }) {
  const { t } = useTranslation();
  const label = t('recipe.linked_badge');
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        'absolute left-3 top-3 z-10',
        'inline-flex h-7 w-7 items-center justify-center',
        'rounded-[var(--radius-pill)] border border-cream-line',
        'bg-paper-2/85 text-saffron backdrop-blur-sm shadow-press',
        className,
      )}
    >
      <Link2 aria-hidden="true" size={14} strokeWidth={1.75} />
    </span>
  );
}
