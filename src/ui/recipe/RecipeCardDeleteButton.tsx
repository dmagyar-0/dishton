import { useDeleteRecipe } from '@/lib/queries/recipes';
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
import { Trash2 } from 'lucide-react';
import type { MouseEvent } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

type Props = {
  recipeId: string;
  recipeTitle: string;
  householdId: string;
  heroImagePath: string | null;
  className?: string;
};

export function RecipeCardDeleteButton({
  recipeId,
  recipeTitle,
  householdId,
  heroImagePath,
  className,
}: Props) {
  const { t } = useTranslation();
  const { push } = useToast();
  const deleteRecipe = useDeleteRecipe(householdId);
  const [open, setOpen] = useState(false);

  const ariaLabel = `${t('recipe.delete_action')}: ${recipeTitle}`;

  const handleTriggerClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setOpen(true);
  };

  const handleConfirm = () => {
    deleteRecipe.mutate(
      { recipeId, heroImagePath },
      {
        onSuccess: () => {
          setOpen(false);
          push({
            variant: 'success',
            title: t('recipe.delete_success_title'),
            description: t('recipe.delete_success_body', { title: recipeTitle }),
          });
        },
        onError: () => {
          push({
            variant: 'error',
            title: t('recipe.delete_failed_title'),
            description: t('recipe.delete_failed_body'),
          });
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (deleteRecipe.isPending) return;
        setOpen(next);
      }}
    >
      <button
        type="button"
        aria-label={ariaLabel}
        title={t('recipe.delete_action')}
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
        <Trash2 aria-hidden="true" size={16} strokeWidth={1.5} />
      </button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('recipe.delete_confirm_title')}</DialogTitle>
          <DialogDescription className="text-base leading-relaxed text-ink-soft">
            {t('recipe.delete_confirm_body', { title: recipeTitle })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={deleteRecipe.isPending}>
              {t('recipe.delete_cancel')}
            </Button>
          </DialogClose>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            loading={deleteRecipe.isPending}
            disabled={deleteRecipe.isPending}
          >
            {t('recipe.delete_confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
