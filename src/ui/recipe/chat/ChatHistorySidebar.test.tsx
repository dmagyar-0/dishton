import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import type { ChatSessionSummary } from '@/lib/queries/recipe-chat';
import { ChatHistorySidebar } from './ChatHistorySidebar';

const base: ChatSessionSummary = {
  id: 's1',
  title: 'Cozy autumn soup',
  status: 'idle',
  recipe_id: null,
  created_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-01T00:00:00Z',
};

function noop() {}

describe('ChatHistorySidebar', () => {
  it('renders a row per session and selects on click', () => {
    const onSelect = vi.fn();
    render(
      <ChatHistorySidebar
        sessions={[base, { ...base, id: 's2', title: 'Spicy ramen' }]}
        activeId={null}
        onSelect={onSelect}
        onNew={noop}
        onRename={noop}
        onDelete={noop}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Spicy ramen' }));
    expect(onSelect).toHaveBeenCalledWith('s2');
  });

  it('shows the untitled fallback when title is null', () => {
    render(
      <ChatHistorySidebar
        sessions={[{ ...base, title: null }]}
        activeId={null}
        onSelect={noop}
        onNew={noop}
        onRename={noop}
        onDelete={noop}
      />,
    );
    expect(screen.getByText('chat.untitled_draft')).toBeInTheDocument();
  });

  it('shows a saved badge when the session produced a recipe', () => {
    render(
      <ChatHistorySidebar
        sessions={[{ ...base, recipe_id: 'r1' }]}
        activeId={null}
        onSelect={noop}
        onNew={noop}
        onRename={noop}
        onDelete={noop}
      />,
    );
    expect(screen.getByText('chat.saved_badge')).toBeInTheDocument();
  });

  it('marks the active row with aria-current', () => {
    render(
      <ChatHistorySidebar
        sessions={[base]}
        activeId="s1"
        onSelect={noop}
        onNew={noop}
        onRename={noop}
        onDelete={noop}
      />,
    );
    expect(screen.getByRole('button', { name: 'Cozy autumn soup' })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('fires onNew from the New chat button', () => {
    const onNew = vi.fn();
    render(
      <ChatHistorySidebar
        sessions={[]}
        activeId={null}
        onSelect={noop}
        onNew={onNew}
        onRename={noop}
        onDelete={noop}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'chat.new_chat' }));
    expect(onNew).toHaveBeenCalled();
  });

  it('shows the empty state when there are no sessions', () => {
    render(
      <ChatHistorySidebar
        sessions={[]}
        activeId={null}
        onSelect={noop}
        onNew={noop}
        onRename={noop}
        onDelete={noop}
      />,
    );
    expect(screen.getByText('chat.history_empty')).toBeInTheDocument();
  });

  it('renames via inline edit on Enter', () => {
    const onRename = vi.fn();
    render(
      <ChatHistorySidebar
        sessions={[base]}
        activeId={null}
        onSelect={noop}
        onNew={noop}
        onRename={onRename}
        onDelete={noop}
      />,
    );
    fireEvent.click(screen.getByLabelText('chat.rename'));
    const input = screen.getByLabelText('chat.rename');
    fireEvent.change(input, { target: { value: 'Harvest soup' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRename).toHaveBeenCalledWith('s1', 'Harvest soup');
  });

  it('cancels rename on Escape without calling onRename', () => {
    const onRename = vi.fn();
    render(
      <ChatHistorySidebar
        sessions={[base]}
        activeId={null}
        onSelect={noop}
        onNew={noop}
        onRename={onRename}
        onDelete={noop}
      />,
    );
    fireEvent.click(screen.getByLabelText('chat.rename'));
    const input = screen.getByLabelText('chat.rename');
    fireEvent.change(input, { target: { value: 'Discard me' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.blur(input);
    expect(onRename).not.toHaveBeenCalled();
  });

  it('commits rename on blur', () => {
    const onRename = vi.fn();
    render(
      <ChatHistorySidebar
        sessions={[base]}
        activeId={null}
        onSelect={noop}
        onNew={noop}
        onRename={onRename}
        onDelete={noop}
      />,
    );
    fireEvent.click(screen.getByLabelText('chat.rename'));
    const input = screen.getByLabelText('chat.rename');
    fireEvent.change(input, { target: { value: 'Blurred title' } });
    fireEvent.blur(input);
    expect(onRename).toHaveBeenCalledWith('s1', 'Blurred title');
  });

  it('deletes after confirming in the dialog', () => {
    const onDelete = vi.fn();
    render(
      <ChatHistorySidebar
        sessions={[base]}
        activeId={null}
        onSelect={noop}
        onNew={noop}
        onRename={noop}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(screen.getByLabelText('chat.delete'));
    fireEvent.click(screen.getByRole('button', { name: 'chat.confirm_delete' }));
    expect(onDelete).toHaveBeenCalledWith('s1');
  });
});
