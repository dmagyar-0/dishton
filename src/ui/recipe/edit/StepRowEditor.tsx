import { cn } from '@/ui/cn';
import { IconButton } from '@/ui/primitives/IconButton';
import { Input } from '@/ui/primitives/Input';
import { Textarea } from '@/ui/primitives/Textarea';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export type StepRowValue = {
  body: string;
  duration_min: number | null;
};

type Props = {
  index: number;
  value: StepRowValue;
  isFirst: boolean;
  isLast: boolean;
  onChange: (patch: Partial<StepRowValue>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  error?: string;
};

export function StepRowEditor({
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

  return (
    <li className="group/row relative grid gap-3 rounded-[var(--radius-md)] border border-cream-line bg-paper-2/40 p-3 sm:p-4">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-saffron/20 font-mono text-sm tabular-nums text-saffron-ink"
        >
          {index + 1}
        </span>

        <Textarea
          rows={3}
          placeholder={t('recipe.field_step_body')}
          value={value.body}
          onChange={(e) => onChange({ body: e.target.value })}
          className="flex-1"
          aria-label={`${t('recipe.field_step_body')} ${index + 1}`}
        />

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

      {error && (
        <p className="ml-11 text-xs text-pomegranate" role="alert">
          {error}
        </p>
      )}

      <div className="ml-11 flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-xs text-ink-soft">
          <span>{t('recipe.field_step_duration')}</span>
          <Input
            type="number"
            min={0}
            inputMode="numeric"
            value={value.duration_min ?? ''}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === '') {
                onChange({ duration_min: null });
                return;
              }
              const n = Number.parseInt(raw, 10);
              onChange({ duration_min: Number.isFinite(n) && n >= 0 ? n : null });
            }}
            className="w-20 text-center font-mono tabular-nums"
            aria-label={t('recipe.field_step_duration')}
          />
        </label>

        <IconButton
          label={t('recipe.remove_row')}
          icon={<Trash2 size={16} strokeWidth={1.5} />}
          onClick={onRemove}
          className="h-8 w-8 text-ink-soft hover:text-pomegranate"
        />
      </div>
    </li>
  );
}
