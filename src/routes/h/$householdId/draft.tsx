import {
  useChatMessages,
  useChatSession,
  useChatSessions,
  useDeleteChatSession,
  useRenameChatSession,
  useSaveDraft,
  useSendChatMessage,
} from '@/lib/queries/recipe-chat';
import { cn } from '@/ui/cn';
import { Button } from '@/ui/primitives/Button';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/ui/primitives/Drawer';
import { useToast } from '@/ui/primitives/Toast';
import { DraftPreviewCard } from '@/ui/recipe/DraftPreviewCard';
import { ChatComposer } from '@/ui/recipe/chat/ChatComposer';
import { ChatHistorySidebar } from '@/ui/recipe/chat/ChatHistorySidebar';
import { ChatThread } from '@/ui/recipe/chat/ChatThread';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { requireAuth } from '../../_guards';

export const Route = createFileRoute('/h/$householdId/draft')({
  beforeLoad: requireAuth,
  component: DraftPage,
});

function DraftPage() {
  const { householdId } = Route.useParams();
  const { t } = useTranslation();
  const navigate = useNavigate({ from: Route.fullPath });
  const { push } = useToast();
  const [chatSessionId, setChatSessionId] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<'chat' | 'draft'>('chat');

  const [historyOpen, setHistoryOpen] = useState(false);

  const sessions = useChatSessions(householdId);
  const rename = useRenameChatSession();
  const del = useDeleteChatSession();

  const openSession = (id: string) => {
    setChatSessionId(id);
    setHistoryOpen(false);
    setMobileView('chat');
  };
  const newChat = () => {
    setChatSessionId(null);
    setHistoryOpen(false);
    setMobileView('chat');
  };
  const onRename = (id: string, title: string) => rename.mutate({ householdId, id, title });
  const onDelete = (id: string) =>
    del.mutate(
      { householdId, id },
      {
        onSuccess: () => {
          if (id === chatSessionId) setChatSessionId(null);
        },
        onError: () => push({ variant: 'error', title: t('chat.save_error') }),
      },
    );

  const messages = useChatMessages(chatSessionId);
  const session = useChatSession(chatSessionId);
  const send = useSendChatMessage(householdId);
  const save = useSaveDraft();

  const draft = session.data?.current_draft ?? null;
  const thinking = session.data?.status === 'running' || send.isPending;

  const onSend = (text: string) => {
    send.mutate(
      { chatSessionId, message: text },
      {
        onSuccess: (id) => setChatSessionId(id),
        onError: () => push({ variant: 'error', title: t('chat.save_error') }),
      },
    );
  };

  const onSave = () => {
    if (!chatSessionId) return;
    save.mutate(chatSessionId, {
      onSuccess: (recipeId) => {
        push({ variant: 'success', title: t('chat.saved_toast') });
        void navigate({
          to: '/h/$householdId/r/$recipeId',
          params: { householdId, recipeId },
        });
      },
      onError: () => push({ variant: 'error', title: t('chat.save_error') }),
    });
  };

  const sidebar = (
    <ChatHistorySidebar
      sessions={sessions.data ?? []}
      activeId={chatSessionId}
      onSelect={openSession}
      onNew={newChat}
      onRename={onRename}
      onDelete={onDelete}
    />
  );

  return (
    <main className="max-w-6xl mx-auto px-4 py-8">
      <h1 className="font-display text-display mb-4">{t('chat.title')}</h1>

      <div className="md:hidden mb-3 flex gap-2">
        <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(true)}>
          {t('chat.history')}
        </Button>
        <Button
          variant={mobileView === 'chat' ? 'primary' : 'ghost'}
          size="sm"
          onClick={() => setMobileView('chat')}
        >
          {t('chat.view_chat')}
        </Button>
        <Button
          variant={mobileView === 'draft' ? 'primary' : 'ghost'}
          size="sm"
          onClick={() => setMobileView('draft')}
        >
          {t('chat.view_draft')}
        </Button>
      </div>

      <div className="md:flex md:gap-6">
        <aside className="hidden md:block md:w-64 md:shrink-0">{sidebar}</aside>

        <div className="flex-1 grid md:grid-cols-2 gap-6">
          <div
            className={cn('flex-col gap-4', mobileView === 'chat' ? 'flex' : 'hidden', 'md:flex')}
          >
            <div className="min-h-[40vh]">
              <ChatThread messages={messages.data ?? []} thinking={thinking} />
            </div>
            <ChatComposer onSend={onSend} disabled={send.isPending} />
          </div>

          <div className={cn(mobileView === 'draft' ? 'block' : 'hidden', 'md:block')}>
            <h2 className="font-display text-xl mb-2">{t('chat.draft_heading')}</h2>
            {draft ? (
              <DraftPreviewCard draft={draft} />
            ) : (
              <p className="text-ink-soft">{t('chat.no_draft_yet')}</p>
            )}
            <Button className="mt-6 w-full" disabled={!draft || save.isPending} onClick={onSave}>
              {t('chat.save')}
            </Button>
          </div>
        </div>
      </div>

      <Drawer open={historyOpen} onOpenChange={setHistoryOpen}>
        <DrawerContent side="bottom" className="md:hidden">
          <DrawerHeader>
            <DrawerTitle>{t('chat.history')}</DrawerTitle>
          </DrawerHeader>
          <div className="overflow-y-auto">{sidebar}</div>
        </DrawerContent>
      </Drawer>
    </main>
  );
}
