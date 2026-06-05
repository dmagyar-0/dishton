import type { Recipe } from '@/domain/recipe';
import { useHouseholdAllowedTags } from '@/lib/queries/households';
import {
  type FullRecipe,
  useIsRecipeEditor,
  useRecipe,
  useUpdateRecipe,
} from '@/lib/queries/recipes';
import { Button } from '@/ui/primitives/Button';
import { Card } from '@/ui/primitives/Card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/primitives/Dialog';
import { Skeleton } from '@/ui/primitives/Skeleton';
import { useToast } from '@/ui/primitives/Toast';
import { RecipeEditForm } from '@/ui/recipe/edit/RecipeEditForm';
import { Link, createFileRoute, useBlocker, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { requireAuth } from '../../../../_guards';

export const Route = createFileRoute('/h/$householdId/r/$recipeId/edit')({
  beforeLoad: requireAuth,
  component: RecipeEditPage,
});

function mapToRecipeDraft(full: FullRecipe): Recipe {
  return {
    title: full.recipe.title,
    description: full.recipe.description,
    source_type: full.recipe.source_type,
    source_url: full.recipe.source_url,
    source_language: full.recipe.source_language,
    canonical_unit_system: full.recipe.canonical_unit_system,
    servings: full.recipe.servings,
    total_time_min: full.recipe.total_time_min,
    hero_image_path: full.recipe.hero_image_path,
    tags: full.tags,
    ingredients: full.ingredients.map((ing) => ({
      position: ing.position,
      raw_text: ing.raw_text,
      quantity: ing.quantity,
      unit: ing.unit,
      ingredient_name: ing.ingredient_name,
      notes: ing.notes,
      scalable: true,
      non_scalable_qty: null,
      section: ing.section,
    })),
    steps: full.steps.map((s) => ({
      position: s.position,
      body: s.body,
      duration_min: s.duration_min,
    })),
  };
}

function RecipeEditPage() {
  const { householdId, recipeId } = Route.useParams();
  const { t } = useTranslation();
  const { push } = useToast();
  const navigate = useNavigate({ from: Route.fullPath });

  const recipeQ = useRecipe(recipeId);
  const { tags: allowedTags, isLoading: tagsLoading } = useHouseholdAllowedTags(householdId);
  const canEdit = useIsRecipeEditor(householdId);
  const update = useUpdateRecipe(recipeId, householdId);

  // Track dirty state in a ref so the submit handler can clear it
  // synchronously before navigating — otherwise the blocker's
  // shouldBlockFn reads the stale state and intercepts our own
  // post-save navigation.
  const dirtyRef = useRef(false);
  const [, setDirtyTick] = useState(0);
  const markDirty = () => {
    if (!dirtyRef.current) {
      dirtyRef.current = true;
      setDirtyTick((n) => n + 1);
    }
  };
  const blocker = useBlocker({
    shouldBlockFn: ({ next, current }) => {
      if (!dirtyRef.current) return false;
      if (next.pathname === current.pathname) return false;
      return true;
    },
    withResolver: true,
    enableBeforeUnload: dirtyRef.current,
  });

  if (recipeQ.isLoading || tagsLoading) {
    return (
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-48" />
        <Skeleton className="h-64" />
      </main>
    );
  }

  if (!recipeQ.data) {
    return <main className="p-8 text-ink-soft">Recipe not found.</main>;
  }

  if (!canEdit) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-12">
        <Card className="space-y-3 text-center">
          <h1 className="font-display text-2xl text-ink">{t('recipe.edit_forbidden_title')}</h1>
          <p className="text-ink-soft">{t('recipe.edit_forbidden_body')}</p>
          <div className="pt-2">
            <Link
              to="/h/$householdId/r/$recipeId"
              params={{ householdId, recipeId }}
              className="inline-flex items-center gap-1 text-sm text-saffron underline-offset-4 hover:underline"
            >
              <ArrowLeft size={14} strokeWidth={1.5} />
              {recipeQ.data.recipe.title}
            </Link>
          </div>
        </Card>
      </main>
    );
  }

  const defaults = mapToRecipeDraft(recipeQ.data);
  const recipeTitle = recipeQ.data.recipe.title;

  const handleSubmit = async (values: Recipe) => {
    try {
      await update.mutateAsync({
        draft: values,
        expectedUpdatedAt: recipeQ.data?.recipe.updated_at ?? null,
      });
      dirtyRef.current = false;
      push({
        variant: 'success',
        title: t('recipe.edit_success_title'),
        description: t('recipe.edit_success_body', { title: values.title }),
      });
      await navigate({
        to: '/h/$householdId/r/$recipeId',
        params: { householdId, recipeId },
      });
    } catch (e) {
      const detail =
        (e as { message?: string } | null)?.message?.trim() ||
        (e as { details?: string } | null)?.details?.trim() ||
        null;
      push({
        variant: 'error',
        title: t('recipe.edit_failed_title'),
        description: detail ?? t('recipe.edit_failed_body'),
      });
    }
  };

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-center gap-3">
        <Link
          to="/h/$householdId/r/$recipeId"
          params={{ householdId, recipeId }}
          className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] text-ink-soft hover:bg-paper-2"
          aria-label={recipeTitle}
        >
          <ArrowLeft size={18} strokeWidth={1.5} />
        </Link>
        <h1 className="font-display text-3xl text-ink">{t('recipe.edit_title')}</h1>
      </div>

      <div onChangeCapture={markDirty}>
        <RecipeEditForm
          defaultValues={defaults}
          allowedTags={allowedTags}
          onSubmit={handleSubmit}
          onCancel={() => {
            dirtyRef.current = false;
            navigate({
              to: '/h/$householdId/r/$recipeId',
              params: { householdId, recipeId },
            });
          }}
          isSubmitting={update.isPending}
        />
      </div>

      <Dialog
        open={blocker.status === 'blocked'}
        onOpenChange={(open) => {
          if (!open && blocker.status === 'blocked') blocker.reset?.();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('recipe.edit_unsaved_confirm')}</DialogTitle>
            <DialogDescription className="text-ink-soft">
              {t('recipe.edit_failed_body')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => blocker.status === 'blocked' && blocker.reset?.()}
            >
              {t('recipe.edit_cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => blocker.status === 'blocked' && blocker.proceed?.()}
            >
              {t('recipe.edit_action')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
