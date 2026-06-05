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
    <div className={cn('inline-flex items-center gap-2', className)}>
      <Select
        ariaLabel={label}
        value={value}
        onValueChange={onChange}
        options={options.map((opt) => ({ value: opt.code, label: `${opt.native} (${opt.code})` }))}
      />
    </div>
  );
}
