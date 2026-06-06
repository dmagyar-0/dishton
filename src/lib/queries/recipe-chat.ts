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

export function useChatMessages(chatSessionId: string | null) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['recipe-chat-messages', chatSessionId],
    enabled: !!chatSessionId,
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
        () => {
          void qc.invalidateQueries({ queryKey: ['recipe-chat-messages', chatSessionId] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [chatSessionId, qc]);

  return query;
}

export function useChatSession(chatSessionId: string | null) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['recipe-chat-session', chatSessionId],
    enabled: !!chatSessionId,
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
        () => {
          void qc.invalidateQueries({ queryKey: ['recipe-chat-session', chatSessionId] });
        },
      )
      .subscribe();
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
