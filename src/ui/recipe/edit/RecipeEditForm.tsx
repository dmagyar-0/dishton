import { normaliseBcp47 } from '@/domain';
import { type Ingredient, Recipe, type Step } from '@/domain/recipe';
import { Button } from '@/ui/primitives/Button';
import { Card } from '@/ui/primitives/Card';
import { Input } from '@/ui/primitives/Input';
import { RadioGroup, RadioGroupItem } from '@/ui/primitives/RadioGroup';
import { Textarea } from '@/ui/primitives/Textarea';
import { TagPicker } from '@/ui/recipe/TagPicker';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus } from 'lucide-react';
import type { Control, FieldErrors, UseFormRegister } from 'react-hook-form';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { IngredientRowEditor, type IngredientRowValue } from './IngredientRowEditor';
import { RecipeImageField } from './RecipeImageField';
import { StepRowEditor, type StepRowValue } from './StepRowEditor';

export type RecipeEditFormProps = {
  defaultValues: Recipe;
  allowedTags: readonly string[];
  onSubmit: (values: Recipe) => Promise<void> | void;
  onCancel: () => void;
  isSubmitting?: boolean;
  submitLabel?: string;
};

function blankIngredient(position: number): Ingredient {
  return {
    position,
    raw_text: '',
    quantity: null,
    unit: null,
    ingredient_name: null,
    notes: null,
    scalable: true,
    non_scalable_qty: null,
    section: null,
  };
}

function blankStep(position: number): Step {
  return { position, body: '', duration_min: null };
}

export function RecipeEditForm({
  defaultValues,
  allowedTags,
  onSubmit,
  onCancel,
  isSubmitting,
  submitLabel,
}: RecipeEditFormProps) {
  const { t } = useTranslation();
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isDirty },
  } = useForm<Recipe>({
    defaultValues,
    mode: 'onBlur',
    // Validate against the frozen Recipe contract client-side: source_language
    // (BCP-47), source_url (URL), ingredient raw_text (min 1), etc.
    resolver: zodResolver(Recipe),
  });

  const submit = handleSubmit(async (values) => {
    const normalized: Recipe = {
      ...values,
      // Coerce a loose language input to the DB-accepted xx / xx-YY form.
      source_language: normaliseBcp47(values.source_language) ?? values.source_language,
      ingredients: values.ingredients.map((ing, i) => ({ ...ing, position: i })),
      steps: values.steps.map((s, i) => ({ ...s, position: i })),
    };
    await onSubmit(normalized);
  });

  return (
    <form onSubmit={submit} className="space-y-8" noValidate data-dirty={isDirty || undefined}>
      <PhotoSection control={control} isSubmitting={isSubmitting} />
      <TagsSection control={control} allowedTags={allowedTags} />
      <BasicsSection register={register} errors={errors} control={control} />
      <IngredientsSection control={control} errors={errors} />
      <StepsSection control={control} errors={errors} />

      <div className="sticky bottom-0 -mx-4 flex items-center justify-end gap-3 border-t border-cream-line bg-paper/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-paper/80 sm:static sm:mx-0 sm:rounded-[var(--radius-md)] sm:border sm:bg-paper-2/60 sm:px-5">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={isSubmitting}>
          {t('recipe.edit_cancel')}
        </Button>
        <Button type="submit" loading={isSubmitting} disabled={isSubmitting}>
          {submitLabel ?? t('recipe.edit_save')}
        </Button>
      </div>
    </form>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-4 font-display text-xl text-ink">
      <span className="inline-block border-b-2 border-saffron pb-1">{children}</span>
    </h2>
  );
}

type RegisterFn = UseFormRegister<Recipe>;
type Errors = FieldErrors<Recipe>;

function BasicsSection({
  register,
  errors,
  control,
}: {
  register: RegisterFn;
  errors: Errors;
  control: Control<Recipe>;
}) {
  const { t } = useTranslation();
  return (
    <Card as="section" className="space-y-4">
      <SectionHeading>{t('recipe.section_basics')}</SectionHeading>

      <Field label={t('recipe.field_title')} error={errors.title?.message}>
        <Input
          {...register('title', { required: true, minLength: 1, maxLength: 200 })}
          aria-invalid={errors.title ? 'true' : undefined}
        />
      </Field>

      <Field label={t('recipe.field_description')} error={errors.description?.message}>
        <Textarea rows={3} {...register('description')} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('recipe.field_servings')} error={errors.servings?.message}>
          <Input
            type="number"
            min={1}
            max={200}
            inputMode="numeric"
            className="font-mono tabular-nums"
            {...register('servings', { valueAsNumber: true, required: true, min: 1, max: 200 })}
          />
        </Field>
        <Field label={t('recipe.field_total_time_min')} error={errors.total_time_min?.message}>
          <Controller
            control={control}
            name="total_time_min"
            render={({ field }) => (
              <Input
                type="number"
                min={0}
                inputMode="numeric"
                className="font-mono tabular-nums"
                value={field.value ?? ''}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === '') {
                    field.onChange(null);
                    return;
                  }
                  const n = Number.parseInt(raw, 10);
                  field.onChange(Number.isFinite(n) && n >= 0 ? n : null);
                }}
                onBlur={field.onBlur}
              />
            )}
          />
        </Field>
      </div>

      <Field label={t('recipe.field_unit_system')}>
        <Controller
          control={control}
          name="canonical_unit_system"
          render={({ field }) => (
            <RadioGroup
              orientation="row"
              value={field.value}
              onValueChange={(v) => field.onChange(v as 'metric' | 'imperial')}
            >
              <RadioGroupItem value="metric" label={t('recipe.field_unit_system_metric')} />
              <RadioGroupItem value="imperial" label={t('recipe.field_unit_system_imperial')} />
            </RadioGroup>
          )}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('recipe.field_source_url')} error={errors.source_url?.message}>
          <Controller
            control={control}
            name="source_url"
            render={({ field }) => (
              <Input
                type="url"
                value={field.value ?? ''}
                onChange={(e) => field.onChange(e.target.value === '' ? null : e.target.value)}
                onBlur={field.onBlur}
              />
            )}
          />
        </Field>
        <Field label={t('recipe.field_source_language')} error={errors.source_language?.message}>
          <Controller
            control={control}
            name="source_language"
            render={({ field }) => (
              <Input
                value={field.value ?? ''}
                onChange={(e) => field.onChange(e.target.value)}
                // Normalise to the DB-accepted xx / xx-YY form on blur so the
                // value validates against the Bcp47 schema (e.g. "en_us" ->
                // "en-US").
                onBlur={() => {
                  field.onChange(normaliseBcp47(field.value) ?? field.value);
                  field.onBlur();
                }}
                className="font-mono uppercase"
              />
            )}
          />
        </Field>
      </div>
    </Card>
  );
}

function IngredientsSection({ control, errors }: { control: Control<Recipe>; errors: Errors }) {
  const { t } = useTranslation();
  const { fields, append, remove, move } = useFieldArray({ control, name: 'ingredients' });

  return (
    <Card as="section">
      <SectionHeading>{t('recipe.section_ingredients')}</SectionHeading>

      <ol className="space-y-3">
        {fields.map((field, idx) => (
          <Controller
            key={field.id}
            control={control}
            name={`ingredients.${idx}`}
            render={({ field: itemField }) => (
              <IngredientRowEditor
                index={idx}
                value={itemField.value as IngredientRowValue}
                isFirst={idx === 0}
                isLast={idx === fields.length - 1}
                onChange={(patch) => itemField.onChange({ ...itemField.value, ...patch })}
                onMoveUp={() => move(idx, idx - 1)}
                onMoveDown={() => move(idx, idx + 1)}
                onRemove={() => remove(idx)}
                error={
                  errors.ingredients?.[idx]?.raw_text
                    ? t('recipe.ingredient_text_required')
                    : undefined
                }
              />
            )}
          />
        ))}
      </ol>

      <div className="mt-4">
        <Button
          type="button"
          variant="ghost"
          leftIcon={<Plus size={16} strokeWidth={1.5} />}
          onClick={() => append(blankIngredient(fields.length))}
        >
          {t('recipe.add_ingredient')}
        </Button>
      </div>
    </Card>
  );
}

function StepsSection({ control, errors }: { control: Control<Recipe>; errors: Errors }) {
  const { t } = useTranslation();
  const { fields, append, remove, move } = useFieldArray({ control, name: 'steps' });

  return (
    <Card as="section">
      <SectionHeading>{t('recipe.section_steps')}</SectionHeading>

      <ol className="space-y-3">
        {fields.map((field, idx) => (
          <Controller
            key={field.id}
            control={control}
            name={`steps.${idx}`}
            render={({ field: itemField }) => (
              <StepRowEditor
                index={idx}
                value={itemField.value as StepRowValue}
                isFirst={idx === 0}
                isLast={idx === fields.length - 1}
                onChange={(patch) => itemField.onChange({ ...itemField.value, ...patch })}
                onMoveUp={() => move(idx, idx - 1)}
                onMoveDown={() => move(idx, idx + 1)}
                onRemove={() => remove(idx)}
                error={errors.steps?.[idx]?.body ? t('recipe.step_body_required') : undefined}
              />
            )}
          />
        ))}
      </ol>

      <div className="mt-4">
        <Button
          type="button"
          variant="ghost"
          leftIcon={<Plus size={16} strokeWidth={1.5} />}
          onClick={() => append(blankStep(fields.length))}
        >
          {t('recipe.add_step')}
        </Button>
      </div>
    </Card>
  );
}

function PhotoSection({
  control,
  isSubmitting,
}: {
  control: Control<Recipe>;
  isSubmitting?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Card as="section">
      <SectionHeading>{t('recipe.section_photo')}</SectionHeading>
      <Controller
        control={control}
        name="hero_image_path"
        render={({ field }) => (
          <RecipeImageField value={field.value} onChange={field.onChange} disabled={isSubmitting} />
        )}
      />
    </Card>
  );
}

function TagsSection({
  control,
  allowedTags,
}: {
  control: Control<Recipe>;
  allowedTags: readonly string[];
}) {
  const { t } = useTranslation();
  return (
    <Card as="section">
      <SectionHeading>{t('recipe.section_tags')}</SectionHeading>
      <Controller
        control={control}
        name="tags"
        render={({ field }) => (
          <TagPicker
            value={field.value ?? []}
            onChange={field.onChange}
            allowedTags={allowedTags}
          />
        )}
      />
    </Card>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="block font-body text-sm text-ink-soft">{label}</span>
      {children}
      {error && <span className="block text-xs text-pomegranate">{error}</span>}
    </label>
  );
}
