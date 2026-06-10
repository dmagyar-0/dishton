// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

// i18n: echo keys so assertions are bundle-independent.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

// Mutable state so individual tests can override.
let messagesData: unknown[] = [];
let sessionData: unknown = undefined;

vi.mock('@/lib/queries/recipe-chat', () => ({
  useChatMessages: () => ({ data: messagesData, isLoading: false }),
  useChatSession: () => ({ data: sessionData }),
  useChatSessions: () => ({ data: [] }),
  useSendChatMessage: () => ({ mutate: vi.fn(), isPending: false }),
  useSaveDraft: () => ({ mutate: vi.fn(), isPending: false }),
  useRenameChatSession: () => ({ mutate: vi.fn() }),
  useDeleteChatSession: () => ({ mutate: vi.fn() }),
}));

vi.mock('@/ui/primitives/Toast', () => ({
  useToast: () => ({ push: vi.fn() }),
}));

vi.mock('@/ui/primitives/Drawer', () => ({
  Drawer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DrawerContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DrawerHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DrawerTitle: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/ui/recipe/DraftPreviewCard', () => ({
  DraftPreviewCard: () => <div data-testid="draft-preview" />,
}));

vi.mock('@/ui/recipe/chat/ChatHistorySidebar', () => ({
  ChatHistorySidebar: () => <div data-testid="chat-history-sidebar" />,
}));

vi.mock('@/ui/recipe/chat/ChatThread', () => ({
  ChatThread: ({ messages }: { messages: unknown[] }) => (
    <div data-testid="chat-thread" data-count={messages.length} />
  ),
}));

// ChatComposer: controlled textarea so suggestion-chip tests can verify the
// value is seeded without triggering a send.
vi.mock('@/ui/recipe/chat/ChatComposer', () => ({
  ChatComposer: ({
    value,
    onValueChange,
  }: {
    value?: string;
    onValueChange?: (v: string) => void;
    onSend: (t: string) => void;
    disabled: boolean;
  }) => (
    <textarea
      data-testid="chat-composer"
      value={value ?? ''}
      onChange={(e) => onValueChange?.(e.target.value)}
    />
  ),
}));

// Mock the router: useNavigate returns a no-op, createFileRoute returns a
// factory whose result exposes useParams so the component can call it.
vi.mock('@tanstack/react-router', () => {
  const useParams = vi.fn(() => ({ householdId: 'h-test' }));
  // createFileRoute returns a function that, when called with options, returns
  // an object whose .useParams delegates to the spy above.
  const createFileRoute = () => (options: Record<string, unknown>) => ({
    ...options,
    useParams,
    fullPath: '/h/h-test/draft',
  });
  return {
    createFileRoute,
    useNavigate: () => () => vi.fn(),
    redirect: vi.fn(() => {
      throw new Error('redirect');
    }),
    Link: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  };
});

vi.mock('../../_guards', () => ({ requireAuth: vi.fn() }));

import { DraftPage } from './draft';

describe('DraftPage — empty state', () => {
  it('shows the empty-state heading when there are no messages', () => {
    messagesData = [];
    sessionData = undefined;

    render(<DraftPage />);

    expect(screen.getByText('chat.empty_heading')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-thread')).not.toBeInTheDocument();
  });

  it('shows the chat thread when messages exist (not the empty state)', () => {
    messagesData = [{ id: '1', role: 'user', content: 'Hello', created_at: '' }];
    sessionData = undefined;

    render(<DraftPage />);

    expect(screen.queryByText('chat.empty_heading')).not.toBeInTheDocument();
    expect(screen.getByTestId('chat-thread')).toBeInTheDocument();
  });

  it('fills the composer when a suggestion chip is clicked (does not auto-send)', async () => {
    messagesData = [];
    sessionData = undefined;

    const user = userEvent.setup();
    render(<DraftPage />);

    // Suggestion chips echo their i18n key text via the echoed-key mock.
    const chip = screen.getByText('chat.suggestion_seasonal');
    await user.click(chip);

    const composer = screen.getByTestId('chat-composer') as HTMLTextAreaElement;
    expect(composer.value).toBe('chat.suggestion_seasonal');
    // Clicking a chip must not trigger a send — the thread stays absent.
    expect(screen.queryByTestId('chat-thread')).not.toBeInTheDocument();
  });
});

describe('DraftPage — Save to pantry button', () => {
  it('hides the Save button when no chat has started', () => {
    messagesData = [];
    sessionData = undefined;

    render(<DraftPage />);

    expect(screen.queryByRole('button', { name: 'chat.save' })).not.toBeInTheDocument();
  });

  it('shows and disables the Save button when chat started but no draft yet', () => {
    messagesData = [{ id: '1', role: 'user', content: 'Hello', created_at: '' }];
    sessionData = { id: 's-1', status: 'idle', current_draft: null, recipe_id: null };

    render(<DraftPage />);

    const btn = screen.getByRole('button', { name: 'chat.save' });
    expect(btn).toBeDisabled();
  });

  it('enables the Save button when a valid draft exists', () => {
    messagesData = [{ id: '1', role: 'user', content: 'Hello', created_at: '' }];
    sessionData = {
      id: 's-1',
      status: 'idle',
      current_draft: {
        title: 'Test recipe',
        description: '',
        servings: 2,
        total_time_min: null,
        canonical_unit_system: 'metric',
        source_type: 'manual',
        source_url: null,
        source_language: null,
        hero_image_path: null,
        tags: [],
        ingredients: [],
        steps: [],
      },
      recipe_id: null,
    };

    render(<DraftPage />);

    const btn = screen.getByRole('button', { name: 'chat.save' });
    expect(btn).not.toBeDisabled();
  });
});
