import type { Recipe } from '@/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from '../supabase';

export type ChatMessage = {
  id: string;
  role: 'user' | 'agent';
  content: string;
  created_at: string;
};

export type ChatSession = {
  id: string;
  status: string;
  current_draft: Recipe | null;
  recipe_id: string | null;
};

// Polling cadence for the realtime fallback. Realtime is the fast path, but a
// dropped or pre-subscription change event would otherwise leave the agent's
// reply stuck in the DB until a manual refresh; we poll while a reply is
// pending so it always lands within a couple seconds.
const POLL_MS = 2000;

// `poll` should be true while the SPA is waiting on the agent (a send is in
// flight or the latest message is the user's). The caller derives it.
export function useChatMessages(chatSessionId: string | null, poll = false) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['recipe-chat-messages', chatSessionId],
    enabled: !!chatSessionId,
    refetchInterval: poll ? POLL_MS : false,
    queryFn: async (): Promise<ChatMessage[]> => {
      const { data, error } = await supabase
        .from('recipe_chat_messages')
        .select('id, role, content, created_at')
        .eq('chat_session_id', chatSessionId)
        .order('created_at');
      if (error) throw error;
      return (data ?? []) as ChatMessage[];
    },
  });

  useEffect(() => {
    if (!chatSessionId) return;
    const invalidate = () =>
      void qc.invalidateQueries({ queryKey: ['recipe-chat-messages', chatSessionId] });
    const channel = supabase
      .channel(`recipe_chat_messages:${chatSessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'app',
          table: 'recipe_chat_messages',
          filter: `chat_session_id=eq.${chatSessionId}`,
        },
        invalidate,
      )
      .subscribe((status) => {
        // Close the subscribe gap: a message inserted between the initial fetch
        // and the subscription becoming live is never delivered as a change
        // event, so refetch once we're actually subscribed.
        if (status === 'SUBSCRIBED') invalidate();
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [chatSessionId, qc]);

  return query;
}

export function useChatSession(chatSessionId: string | null, poll = false) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['recipe-chat-session', chatSessionId],
    enabled: !!chatSessionId,
    refetchInterval: poll ? POLL_MS : false,
    queryFn: async (): Promise<ChatSession> => {
      const { data, error } = await supabase
        .from('recipe_chat_sessions')
        .select('id, status, current_draft, recipe_id')
        .eq('id', chatSessionId)
        .single();
      if (error) throw error;
      return data as ChatSession;
    },
  });

  useEffect(() => {
    if (!chatSessionId) return;
    const invalidate = () =>
      void qc.invalidateQueries({ queryKey: ['recipe-chat-session', chatSessionId] });
    const channel = supabase
      .channel(`recipe_chat_session:${chatSessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'app',
          table: 'recipe_chat_sessions',
          filter: `id=eq.${chatSessionId}`,
        },
        invalidate,
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') invalidate();
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [chatSessionId, qc]);

  return query;
}

export function useSendChatMessage(householdId: string) {
  return useMutation({
    mutationFn: async (args: {
      chatSessionId: string | null;
      message: string;
    }): Promise<string> => {
      const { data, error } = await supabase.functions.invoke('recipe-chat-send', {
        body: {
          chat_session_id: args.chatSessionId ?? undefined,
          message: args.message,
          household_id: householdId,
        },
      });
      if (error) throw error;
      return (data as { chat_session_id: string }).chat_session_id;
    },
  });
}

export function useSaveDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (chatSessionId: string): Promise<string> => {
      const { data, error } = await supabase.functions.invoke('recipe-chat-save', {
        body: { chat_session_id: chatSessionId },
      });
      if (error) throw error;
      return (data as { recipe_id: string }).recipe_id;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['recipes'] });
    },
  });
}

export type ChatSessionSummary = {
  id: string;
  title: string | null;
  status: string;
  recipe_id: string | null;
  created_at: string;
  updated_at: string;
};

export function useChatSessions(householdId: string | null) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['recipe-chat-sessions', householdId],
    enabled: !!householdId,
    queryFn: async (): Promise<ChatSessionSummary[]> => {
      const { data, error } = await supabase
        .from('recipe_chat_sessions')
        .select('id, title, status, recipe_id, created_at, updated_at')
        .eq('household_id', householdId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as ChatSessionSummary[];
    },
  });

  useEffect(() => {
    if (!householdId) return;
    const channel = supabase
      .channel(`recipe_chat_sessions:household:${householdId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'app',
          table: 'recipe_chat_sessions',
          filter: `household_id=eq.${householdId}`,
        },
        () => {
          void qc.invalidateQueries({ queryKey: ['recipe-chat-sessions', householdId] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [householdId, qc]);

  return query;
}

export function useRenameChatSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { householdId: string; id: string; title: string }): Promise<void> => {
      const { error } = await supabase
        .from('recipe_chat_sessions')
        .update({ title: args.title })
        .eq('id', args.id);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['recipe-chat-sessions', vars.householdId] });
      void qc.invalidateQueries({ queryKey: ['recipe-chat-session', vars.id] });
    },
  });
}

export function useDeleteChatSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { householdId: string; id: string }): Promise<void> => {
      const { error } = await supabase.from('recipe_chat_sessions').delete().eq('id', args.id);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['recipe-chat-sessions', vars.householdId] });
      qc.removeQueries({ queryKey: ['recipe-chat-session', vars.id] });
    },
  });
}
