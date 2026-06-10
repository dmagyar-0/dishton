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
let messagesIsLoading = false;
let sessionData: unknown = undefined;

vi.mock('@/lib/queries/recipe-chat', () => ({
  useChatMessages: () => ({ data: messagesData, isLoading: messagesIsLoading }),
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
  ChatHistorySidebar: ({
    onSelect,
  }: {
    onSelect?: (id: string) => void;
    sessions: unknown[];
    activeId: string | null;
    onNew: () => void;
    onRename: (id: string, title: string) => void;
    onDelete: (id: string) => void;
  }) => (
    <div data-testid="chat-history-sidebar">
      <button type="button" data-testid="select-session" onClick={() => onSelect?.('session-123')}>
        select session
      </button>
    </div>
  ),
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

const mockNavigate = vi.fn();

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
    useNavigate: () => mockNavigate,
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
    messagesIsLoading = false;
    sessionData = undefined;

    render(<DraftPage />);

    expect(screen.getByText('chat.empty_heading')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-thread')).not.toBeInTheDocument();
  });

  it('shows a skeleton and hides the empty state while a selected session is loading messages', async () => {
    // Simulate the flash-of-wrong-content bug: user selects an existing session
    // from the history sidebar. The messages query refetches and isLoading is
    // true while data is undefined. The empty state must NOT flash during this.
    messagesData = [];
    messagesIsLoading = true;
    sessionData = undefined;

    const user = userEvent.setup();
    render(<DraftPage />);

    // Click the sidebar's "select session" button to set chatSessionId state.
    // There are two sidebar instances (desktop aside + mobile drawer); pick the first.
    const selectBtns = screen.getAllByTestId('select-session');
    expect(selectBtns).toHaveLength(2); // desktop aside + mobile drawer
    await user.click(selectBtns[0] as HTMLElement);

    // With chatSessionId set and messages loading, the skeleton should render.
    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0);
    // The empty-state heading must NOT flash during the loading phase.
    expect(screen.queryByText('chat.empty_heading')).not.toBeInTheDocument();
  });

  it('shows the chat thread when messages exist (not the empty state)', () => {
    messagesData = [{ id: '1', role: 'user', content: 'Hello', created_at: '' }];
    messagesIsLoading = false;
    sessionData = undefined;

    render(<DraftPage />);

    expect(screen.queryByText('chat.empty_heading')).not.toBeInTheDocument();
    expect(screen.getByTestId('chat-thread')).toBeInTheDocument();
  });

  it('fills the composer when a suggestion chip is clicked (does not auto-send)', async () => {
    messagesData = [];
    messagesIsLoading = false;
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
    messagesIsLoading = false;
    sessionData = undefined;

    render(<DraftPage />);

    expect(screen.queryByRole('button', { name: 'chat.save' })).not.toBeInTheDocument();
  });

  it('shows and disables the Save button when chat started but no draft yet', () => {
    messagesData = [{ id: '1', role: 'user', content: 'Hello', created_at: '' }];
    messagesIsLoading = false;
    sessionData = { id: 's-1', status: 'idle', current_draft: null, recipe_id: null };

    render(<DraftPage />);

    const btn = screen.getByRole('button', { name: 'chat.save' });
    expect(btn).toBeDisabled();
  });

  it('enables the Save button when a valid draft exists', () => {
    messagesData = [{ id: '1', role: 'user', content: 'Hello', created_at: '' }];
    messagesIsLoading = false;
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
