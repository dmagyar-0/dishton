import { formatQuantityForInput, parseQuantityInput } from '@/domain/quantity-parse';
import type { Ingredient } from '@/domain/recipe';
import { cn } from '@/ui/cn';
import { IconButton } from '@/ui/primitives/IconButton';
import { Input } from '@/ui/primitives/Input';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

export type IngredientRowValue = {
  raw_text: string;
  quantity: Ingredient['quantity'];
  unit: string | null;
  ingredient_name: string | null;
  notes: string | null;
  section: string | null;
};

type Props = {
  index: number;
  value: IngredientRowValue;
  isFirst: boolean;
  isLast: boolean;
  onChange: (patch: Partial<IngredientRowValue>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  error?: string;
};

export function IngredientRowEditor({
  index,
  value,
  isFirst,
  isLast,
  onChange,
  onMoveUp,
  onMoveDown,
  onRemove,
  error,
}: Props) {
  const { t } = useTranslation();
  const [quantityDraft, setQuantityDraft] = useState(() => formatQuantityForInput(value.quantity));
  const [quantityError, setQuantityError] = useState<string | null>(null);

  useEffect(() => {
    setQuantityDraft(formatQuantityForInput(value.quantity));
  }, [value.quantity]);

  const commitQuantity = (raw: string) => {
    const parsed = parseQuantityInput(raw);
    if (!parsed.ok) {
      setQuantityError(t('recipe.quantity_invalid'));
      return;
    }
    setQuantityError(null);
    onChange({ quantity: parsed.value });
  };

  return (
    <li className="group/row relative grid gap-2 rounded-[var(--radius-md)] border border-cream-line bg-paper-2/40 p-3 sm:p-4">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sage/20 font-mono text-xs tabular-nums text-ink-soft"
        >
          {index + 1}
        </span>

        <div className="grid flex-1 gap-2 sm:grid-cols-[5rem_6rem_1fr] sm:gap-3">
          <label className="block">
            <span className="sr-only">{t('recipe.field_ingredient_quantity')}</span>
            <Input
              inputMode="decimal"
              placeholder={t('recipe.quantity_placeholder')}
              value={quantityDraft}
              aria-invalid={quantityError ? 'true' : undefined}
              onChange={(e) => setQuantityDraft(e.target.value)}
              onBlur={(e) => commitQuantity(e.target.value)}
              className="text-center font-mono tabular-nums"
            />
          </label>

          <label className="block">
            <span className="sr-only">{t('recipe.field_ingredient_unit')}</span>
            <Input
              placeholder={t('recipe.field_ingredient_unit')}
              value={value.unit ?? ''}
              onChange={(e) => onChange({ unit: e.target.value === '' ? null : e.target.value })}
            />
          </label>

          <label className="block">
            <span className="sr-only">{t('recipe.field_ingredient_name')}</span>
            <Input
              placeholder={t('recipe.field_ingredient_name')}
              value={value.ingredient_name ?? ''}
              onChange={(e) =>
                onChange({ ingredient_name: e.target.value === '' ? null : e.target.value })
              }
            />
          </label>
        </div>

        <div className="flex shrink-0 flex-col gap-0.5">
          <IconButton
            label={t('recipe.move_up')}
            icon={<ArrowUp size={16} strokeWidth={1.5} />}
            onClick={onMoveUp}
            disabled={isFirst}
            className={cn('h-8 w-8', isFirst && 'invisible')}
          />
          <IconButton
            label={t('recipe.move_down')}
            icon={<ArrowDown size={16} strokeWidth={1.5} />}
            onClick={onMoveDown}
            disabled={isLast}
            className={cn('h-8 w-8', isLast && 'invisible')}
          />
        </div>
      </div>

      {quantityError && (
        <p className="ml-10 text-xs text-pomegranate" role="alert">
          {quantityError}
        </p>
      )}

      <div className="ml-10 grid gap-2 sm:grid-cols-2 sm:gap-3">
        <label className="block">
          <span className="sr-only">{t('recipe.field_ingredient_section')}</span>
          <Input
            placeholder={t('recipe.section_placeholder')}
            value={value.section ?? ''}
            onChange={(e) => onChange({ section: e.target.value === '' ? null : e.target.value })}
          />
        </label>
        <label className="block">
          <span className="sr-only">{t('recipe.field_ingredient_notes')}</span>
          <Input
            placeholder={t('recipe.field_ingredient_notes')}
            value={value.notes ?? ''}
            onChange={(e) => onChange({ notes: e.target.value === '' ? null : e.target.value })}
          />
        </label>
      </div>

      <div className="ml-10 flex items-center justify-between gap-2">
        <Input
          placeholder={t('recipe.field_ingredient_raw_text')}
          value={value.raw_text}
          onChange={(e) => onChange({ raw_text: e.target.value })}
          className="flex-1 text-sm text-ink-soft"
          aria-label={t('recipe.field_ingredient_raw_text')}
        />
        <IconButton
          label={t('recipe.remove_row')}
          icon={<Trash2 size={16} strokeWidth={1.5} />}
          onClick={onRemove}
          className="h-8 w-8 text-ink-soft hover:text-pomegranate"
        />
      </div>

      {error && (
        <p className="ml-10 text-xs text-pomegranate" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}
