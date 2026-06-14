import { useRemoveRecipeLink, useSaveRecipeLink } from '@/lib/queries/recipe-links';
import { cn } from '@/ui/cn';
import { useToast } from '@/ui/primitives/Toast';
import { Bookmark, BookmarkCheck } from 'lucide-react';
import type { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

type Props = {
  recipeId: string;
  recipeTitle: string;
  // The household the link is saved into (the viewer's pantry).
  pantryHouseholdId: string;
  saved: boolean;
  className?: string;
};

// Overlay toggle shown on a followed household's recipe cards. Saving creates a
// live link into the viewer's pantry; tapping again removes it. Low-stakes, so
// no confirm dialog here (the home page guards removal with a confirm).
export function RecipeCardSaveButton({
  recipeId,
  recipeTitle,
  pantryHouseholdId,
  saved,
  className,
}: Props) {
  const { t } = useTranslation();
  const { push } = useToast();
  const save = useSaveRecipeLink(pantryHouseholdId);
  const remove = useRemoveRecipeLink(pantryHouseholdId);
  const pending = save.isPending || remove.isPending;

  const label = saved ? t('recipe.save_link_saved') : t('recipe.save_link_action');

  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (pending) return;
    if (saved) {
      remove.mutate(recipeId, {
        onSuccess: () =>
          push({
            variant: 'success',
            title: t('recipe.remove_link_success_title'),
            description: t('recipe.remove_link_success_body', { title: recipeTitle }),
          }),
        onError: () =>
          push({
            variant: 'error',
            title: t('recipe.remove_link_failed_title'),
            description: t('recipe.remove_link_failed_body'),
          }),
      });
      return;
    }
    save.mutate(recipeId, {
      onSuccess: () =>
        push({
          variant: 'success',
          title: t('recipe.save_link_success_title'),
          description: t('recipe.save_link_success_body', { title: recipeTitle }),
        }),
      onError: () =>
        push({
          variant: 'error',
          title: t('recipe.save_link_failed_title'),
          description: t('recipe.save_link_failed_body'),
        }),
    });
  };

  return (
    <button
      type="button"
      aria-label={`${label}: ${recipeTitle}`}
      aria-pressed={saved}
      title={label}
      onClick={handleClick}
      disabled={pending}
      className={cn(
        'absolute right-3 top-3 z-10',
        'inline-flex h-9 w-9 items-center justify-center',
        'rounded-[var(--radius-pill)] border border-cream-line',
        'bg-paper-2/85 backdrop-blur-sm shadow-press',
        'transition-[opacity,color,background-color] duration-[var(--duration-fast)]',
        'focus-visible:opacity-100 focus-visible:outline-none',
        saved
          ? 'text-saffron hover:bg-paper-2'
          : 'text-ink-soft hover:bg-paper-2 hover:text-saffron md:opacity-0 md:group-hover/card:opacity-100 md:group-focus-within/card:opacity-100',
        className,
      )}
    >
      {saved ? (
        <BookmarkCheck aria-hidden="true" size={16} strokeWidth={1.5} />
      ) : (
        <Bookmark aria-hidden="true" size={16} strokeWidth={1.5} />
      )}
    </button>
  );
}
