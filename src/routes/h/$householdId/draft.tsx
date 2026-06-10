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
import { EmptyState } from '@/ui/primitives/EmptyState';
import { Skeleton } from '@/ui/primitives/Skeleton';
import { useToast } from '@/ui/primitives/Toast';
import { DraftPreviewCard } from '@/ui/recipe/DraftPreviewCard';
import { ChatComposer } from '@/ui/recipe/chat/ChatComposer';
import { ChatHistorySidebar } from '@/ui/recipe/chat/ChatHistorySidebar';
import { ChatThread } from '@/ui/recipe/chat/ChatThread';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { requireAuth } from '../../_guards';

export const Route = createFileRoute('/h/$householdId/draft')({
  beforeLoad: requireAuth,
  component: DraftPage,
});

const SUGGESTIONS = [
  'chat.suggestion_seasonal',
  'chat.suggestion_quick',
  'chat.suggestion_vegetarian',
] as const;

// Exported for co-located component tests.
export function DraftPage() {
  const { householdId } = Route.useParams();
  const { t } = useTranslation();
  const navigate = useNavigate({ from: Route.fullPath });
  const { push } = useToast();
  const [chatSessionId, setChatSessionId] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<'chat' | 'draft'>('chat');
  const [composerValue, setComposerValue] = useState('');

  const [historyOpen, setHistoryOpen] = useState(false);

  // The history Drawer is mobile-only (its trigger is `md:hidden`). If the
  // viewport grows to desktop while it's open (e.g. a phone rotated to
  // landscape), close it so its overlay doesn't linger over the desktop layout.
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const closeOnDesktop = () => {
      if (mq.matches) setHistoryOpen(false);
    };
    mq.addEventListener('change', closeOnDesktop);
    return () => mq.removeEventListener('change', closeOnDesktop);
  }, []);

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
  const onRename = (id: string, title: string) =>
    rename.mutate(
      { householdId, id, title },
      { onError: () => push({ variant: 'error', title: t('chat.save_error') }) },
    );
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

  const send = useSendChatMessage(householdId);
  const save = useSaveDraft();

  // We're "awaiting" the agent whenever a send is in flight or the newest
  // message is still the user's. While awaiting, the queries poll as a fallback
  // so the reply + draft appear even if a realtime change event is missed
  // (e.g. the subscribe gap on a brand-new session). Realtime stays the fast
  // path; this just guarantees the update lands without a manual refresh.
  const [awaitingReply, setAwaitingReply] = useState(false);
  const poll = awaitingReply || send.isPending;

  const messages = useChatMessages(chatSessionId, poll);
  const session = useChatSession(chatSessionId, poll);

  useEffect(() => {
    const list = messages.data;
    const last = list && list.length > 0 ? list[list.length - 1] : undefined;
    setAwaitingReply(last?.role === 'user');
  }, [messages.data]);

  const draft = session.data?.current_draft ?? null;
  const thinking = send.isPending || awaitingReply || session.data?.status === 'running';

  // The chat is "started" once the session exists or messages have loaded. We
  // use this to decide whether to show the empty state vs. the live thread, and
  // whether to show the Save button at all.
  const messagesLoading = chatSessionId != null && messages.isLoading;
  const hasMessages = (messages.data?.length ?? 0) > 0;
  const chatStarted = chatSessionId !== null || hasMessages;

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
          {/* Chat column: flex column so thread grows and input pins to the bottom */}
          <div
            className={cn(
              'flex-col gap-4 min-h-[60vh]',
              mobileView === 'chat' ? 'flex' : 'hidden',
              'md:flex',
            )}
          >
            <div className="flex-1 flex flex-col justify-end">
              {messagesLoading ? (
                <div className="flex flex-col gap-3 p-4">
                  <Skeleton className="h-12 w-3/4" />
                  <Skeleton className="h-12 w-1/2 self-end" />
                  <Skeleton className="h-12 w-2/3" />
                </div>
              ) : hasMessages ? (
                <ChatThread messages={messages.data ?? []} thinking={thinking} />
              ) : (
                <EmptyState
                  title={t('chat.empty_heading')}
                  description={t('chat.empty_body')}
                  action={
                    <div className="flex flex-wrap justify-center gap-2">
                      {SUGGESTIONS.map((key) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setComposerValue(t(key))}
                          className={cn(
                            'rounded-[var(--radius-pill)] border border-cream-line bg-paper-2 px-3 py-1.5',
                            'font-body text-sm text-ink',
                            'transition-colors duration-[var(--duration-fast)]',
                            'hover:bg-saffron/10 hover:border-saffron/40',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-saffron/50',
                          )}
                        >
                          {t(key)}
                        </button>
                      ))}
                    </div>
                  }
                />
              )}
            </div>
            <ChatComposer
              onSend={onSend}
              disabled={send.isPending}
              value={composerValue}
              onValueChange={setComposerValue}
            />
          </div>

          {/* Draft panel: shown when there's a draft or a chat in progress */}
          <div className={cn(mobileView === 'draft' ? 'block' : 'hidden', 'md:block')}>
            <h2 className="font-display text-xl mb-2">{t('chat.draft_heading')}</h2>
            {draft ? (
              <DraftPreviewCard draft={draft} />
            ) : (
              <p className="text-ink-soft">{t('chat.no_draft_yet')}</p>
            )}
            {chatStarted && (
              <Button className="mt-6 w-full" disabled={!draft || save.isPending} onClick={onSave}>
                {t('chat.save')}
              </Button>
            )}
          </div>
        </div>
      </div>

      <Drawer open={historyOpen} onOpenChange={setHistoryOpen}>
        <DrawerContent side="bottom" className="md:hidden">
          <DrawerHeader>
            <DrawerTitle>{t('chat.history')}</DrawerTitle>
          </DrawerHeader>
          <div className="flex-1 min-h-0 overflow-y-auto">{sidebar}</div>
        </DrawerContent>
      </Drawer>
    </main>
  );
}
