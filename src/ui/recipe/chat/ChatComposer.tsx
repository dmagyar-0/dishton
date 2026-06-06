import { Button } from '@/ui/primitives/Button';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export function ChatComposer({
  onSend,
  disabled,
}: {
  onSend: (text: string) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState('');

  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = text.trim();
        if (trimmed) {
          onSend(trimmed);
          setText('');
        }
      }}
    >
      <textarea
        className="flex-1 resize-none rounded-xl border border-ink/15 px-3 py-2"
        rows={2}
        value={text}
        placeholder={t('chat.placeholder')}
        aria-label={t('chat.placeholder')}
        onChange={(e) => setText(e.target.value)}
      />
      <Button type="submit" disabled={disabled || !text.trim()}>
        {t('chat.send')}
      </Button>
    </form>
  );
}
