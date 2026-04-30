import { cn } from '@/ui/cn';
import { Select } from '@/ui/primitives/Select';

export type LanguageOption = { code: string; native: string };

export type LanguageToggleProps = {
  value: string;
  options: LanguageOption[];
  onChange: (code: string) => void;
  className?: string;
  label?: string;
};

export function LanguageToggle({
  value,
  options,
  onChange,
  className,
  label = 'Language',
}: LanguageToggleProps) {
  return (
    <label className={cn('inline-flex items-center gap-2', className)}>
      <span className="sr-only">{label}</span>
      <Select aria-label={label} value={value} onChange={(e) => onChange(e.currentTarget.value)}>
        {options.map((opt) => (
          <option key={opt.code} value={opt.code}>
            {opt.native} ({opt.code})
          </option>
        ))}
      </Select>
    </label>
  );
}
