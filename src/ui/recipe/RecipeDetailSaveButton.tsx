import { useRemoveRecipeLink, useSaveRecipeLink } from '@/lib/queries/recipe-links';
import { useToast } from '@/ui/primitives/Toast';
import { Bookmark, BookmarkCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type Props = {
  recipeId: string;
  recipeTitle: string;
  pantryHouseholdId: string;
  saved: boolean;
};

// Labeled save/remove toggle for the recipe detail page, shown when viewing a
// followed household's recipe. Mirrors the Edit link's styling so it sits in the
// same title-row action cluster.
export function RecipeDetailSaveButton({ recipeId, recipeTitle, pantryHouseholdId, saved }: Props) {
  const { t } = useTranslation();
  const { push } = useToast();
  const save = useSaveRecipeLink(pantryHouseholdId);
  const remove = useRemoveRecipeLink(pantryHouseholdId);
  const pending = save.isPending || remove.isPending;

  const label = saved ? t('recipe.save_link_saved') : t('recipe.save_link_action');

  const handleClick = () => {
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
      onClick={handleClick}
      disabled={pending}
      aria-pressed={saved}
      aria-label={label}
      className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] border border-cream-line bg-paper-2 px-3 text-sm text-ink-soft transition-colors duration-[var(--duration-fast)] hover:bg-paper hover:text-ink disabled:opacity-60"
    >
      {saved ? (
        <BookmarkCheck size={14} strokeWidth={1.5} className="text-saffron" aria-hidden="true" />
      ) : (
        <Bookmark size={14} strokeWidth={1.5} aria-hidden="true" />
      )}
      <span>{label}</span>
    </button>
  );
}
