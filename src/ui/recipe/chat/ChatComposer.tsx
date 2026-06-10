import { Button } from '@/ui/primitives/Button';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export function ChatComposer({
  onSend,
  disabled,
  value,
  onValueChange,
}: {
  onSend: (text: string) => void;
  disabled: boolean;
  /** Optional controlled value — lets parent seed the textarea (e.g. suggestion chips). */
  value?: string;
  onValueChange?: (v: string) => void;
}) {
  const { t } = useTranslation();
  const [internal, setInternal] = useState('');

  const text = value !== undefined ? value : internal;
  const handleChange = (v: string) => {
    if (onValueChange) {
      onValueChange(v);
    } else {
      setInternal(v);
    }
  };

  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = text.trim();
        if (trimmed) {
          onSend(trimmed);
          handleChange('');
        }
      }}
    >
      <textarea
        className="flex-1 resize-none rounded-xl border border-ink/15 px-3 py-2"
        rows={2}
        value={text}
        placeholder={t('chat.placeholder')}
        aria-label={t('chat.placeholder')}
        onChange={(e) => handleChange(e.target.value)}
      />
      <Button type="submit" disabled={disabled || !text.trim()}>
        {t('chat.send')}
      </Button>
    </form>
  );
}
