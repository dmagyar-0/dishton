import { useRemoveRecipeLink } from '@/lib/queries/recipe-links';
import { cn } from '@/ui/cn';
import { Button } from '@/ui/primitives/Button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/primitives/Dialog';
import { useToast } from '@/ui/primitives/Toast';
import { BookmarkX } from 'lucide-react';
import type { MouseEvent } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

type Props = {
  recipeId: string;
  recipeTitle: string;
  // The pantry household the link lives in.
  householdId: string;
  className?: string;
};

// Shown on a linked (followed) recipe card on the home page. Removes only the
// pantry link — the original recipe is owned elsewhere and stays untouched, so
// we confirm to make that distinction clear.
export function RecipeCardRemoveLinkButton({
  recipeId,
  recipeTitle,
  householdId,
  className,
}: Props) {
  const { t } = useTranslation();
  const { push } = useToast();
  const remove = useRemoveRecipeLink(householdId);
  const [open, setOpen] = useState(false);

  const handleTriggerClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setOpen(true);
  };

  const handleConfirm = () => {
    remove.mutate(recipeId, {
      onSuccess: () => {
        setOpen(false);
        push({
          variant: 'success',
          title: t('recipe.remove_link_success_title'),
          description: t('recipe.remove_link_success_body', { title: recipeTitle }),
        });
      },
      onError: () => {
        push({
          variant: 'error',
          title: t('recipe.remove_link_failed_title'),
          description: t('recipe.remove_link_failed_body'),
        });
      },
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (remove.isPending) return;
        setOpen(next);
      }}
    >
      <button
        type="button"
        aria-label={`${t('recipe.remove_link_action')}: ${recipeTitle}`}
        title={t('recipe.remove_link_action')}
        onClick={handleTriggerClick}
        className={cn(
          'absolute right-3 top-3 z-10',
          'inline-flex h-9 w-9 items-center justify-center',
          'rounded-[var(--radius-pill)] border border-cream-line',
          'bg-paper-2/85 text-ink-soft backdrop-blur-sm shadow-press',
          'transition-[opacity,color,background-color] duration-[var(--duration-fast)]',
          'hover:bg-paper-2 hover:text-pomegranate',
          'focus-visible:opacity-100 focus-visible:outline-none',
          'md:opacity-0 md:group-hover/card:opacity-100 md:group-focus-within/card:opacity-100',
          className,
        )}
      >
        <BookmarkX aria-hidden="true" size={16} strokeWidth={1.5} />
      </button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('recipe.remove_link_confirm_title')}</DialogTitle>
          <DialogDescription className="text-base leading-relaxed text-ink-soft">
            {t('recipe.remove_link_confirm_body', { title: recipeTitle })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={remove.isPending}>
              {t('recipe.remove_link_cancel')}
            </Button>
          </DialogClose>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            loading={remove.isPending}
            disabled={remove.isPending}
          >
            {t('recipe.remove_link_confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
