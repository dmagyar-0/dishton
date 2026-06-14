import {
  useChatMessages,
  useChatSession,
  useChatSessions,
  useDeleteChatSession,
  useRenameChatSession,
  useSaveDraft,
  useSendChatMessage,
} from '@/lib/queries/recipe-chat';
import { Badge } from '@/ui/primitives/Badge';
import { Button } from '@/ui/primitives/Button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/primitives/Tabs';
import { useToast } from '@/ui/primitives/Toast';
import { DraftPreviewCard } from '@/ui/recipe/DraftPreviewCard';
import { ChatComposer } from '@/ui/recipe/chat/ChatComposer';
import { ChatHistorySidebar } from '@/ui/recipe/chat/ChatHistorySidebar';
import { ChatThread } from '@/ui/recipe/chat/ChatThread';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

type SubTab = 'chat' | 'sessions' | 'draft';

// The chat-based "Draft with AI" experience, surfaced as a tab inside the
// Import page. Chat, session history, and the live draft are split across
// three sub-tabs (defaulting to Chat) rather than the old side-by-side layout,
// so the flow works the same at every viewport without a mobile drawer.
export function DraftWorkspace({ householdId }: { householdId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { push } = useToast();
  const [chatSessionId, setChatSessionId] = useState<string | null>(null);
  const [tab, setTab] = useState<SubTab>('chat');

  const sessions = useChatSessions(householdId);
  const rename = useRenameChatSession();
  const del = useDeleteChatSession();

  const openSession = (id: string) => {
    setChatSessionId(id);
    setTab('chat');
  };
  const newChat = () => {
    setChatSessionId(null);
    setTab('chat');
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

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as SubTab)} className="mt-2">
      <TabsList>
        <TabsTrigger value="chat">{t('chat.subtab_chat')}</TabsTrigger>
        <TabsTrigger value="sessions">{t('chat.subtab_sessions')}</TabsTrigger>
        <TabsTrigger value="draft">
          <span className="inline-flex items-center gap-2">
            {t('chat.subtab_draft')}
            {draft && <Badge variant="secondary">{t('chat.draft_ready_badge')}</Badge>}
          </span>
        </TabsTrigger>
      </TabsList>

      <TabsContent value="chat">
        <div className="flex flex-col gap-4">
          <div className="min-h-[30dvh]">
            <ChatThread messages={messages.data ?? []} thinking={thinking} />
          </div>
          {/* Pin the composer to the bottom of the viewport. The thread grows
              the page, so on an empty chat (the default sub-tab) a tall fixed
              reserve used to shove the composer below the fold on mobile —
              sticky keeps it on screen at every viewport and message count. */}
          <div className="sticky bottom-0 -mx-4 border-t border-cream-line bg-paper/95 px-4 py-3 backdrop-blur">
            <ChatComposer onSend={onSend} disabled={send.isPending} />
          </div>
        </div>
      </TabsContent>

      <TabsContent value="sessions">
        <ChatHistorySidebar
          sessions={sessions.data ?? []}
          activeId={chatSessionId}
          onSelect={openSession}
          onNew={newChat}
          onRename={onRename}
          onDelete={onDelete}
        />
      </TabsContent>

      <TabsContent value="draft">
        {draft ? (
          <DraftPreviewCard draft={draft} />
        ) : (
          <p className="text-ink-soft">{t('chat.no_draft_yet')}</p>
        )}
        <Button className="mt-6 w-full" disabled={!draft || save.isPending} onClick={onSave}>
          {t('chat.save')}
        </Button>
      </TabsContent>
    </Tabs>
  );
}
