import type { ChatMessage, ChatPhase } from '@/lib/queries/recipe-chat';
import { cn } from '@/ui/cn';
import { useTranslation } from 'react-i18next';

const PHASE_LABEL: Record<ChatPhase, string> = {
  thinking: 'chat.thinking',
  searching: 'chat.phase_searching',
  drafting: 'chat.phase_drafting',
};

export function ChatThread({
  messages,
  thinking,
  phase = 'thinking',
}: {
  messages: ChatMessage[];
  thinking: boolean;
  phase?: ChatPhase;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      {messages.map((m) => (
        <div
          key={m.id}
          className={cn(
            'max-w-[85%] rounded-2xl px-4 py-2',
            m.role === 'user' ? 'self-end bg-saffron/15' : 'self-start bg-ink/5',
          )}
        >
          <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
        </div>
      ))}
      {thinking && (
        <p className="self-start text-ink-soft text-sm italic" role="status">
          {t(PHASE_LABEL[phase])}
        </p>
      )}
    </div>
  );
}
