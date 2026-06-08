import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import type { ActiveImport } from '@/lib/imports/ActiveImportsProvider';
import { ImportQueue } from './ImportQueue';

const base: ActiveImport = {
  jobId: 'j1',
  householdId: 'h1',
  kind: 'url',
  status: 'running',
  phase: 'ai',
  progressText: null,
  recipeId: null,
  sourceUrl: 'https://smittenkitchen.com/tart',
  origin: 'this-tab',
  createdAt: '2026-06-07T00:00:00Z',
  completedAt: null,
};

const noop = () => {};

describe('ImportQueue', () => {
  it('renders nothing when there are no items', () => {
    const { container } = render(<ImportQueue items={[]} onDismiss={noop} onView={noop} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the source host and the running phase label', () => {
    render(<ImportQueue items={[base]} onDismiss={noop} onView={noop} />);
    expect(screen.getByText('smittenkitchen.com')).toBeInTheDocument();
    expect(screen.getByText('import.phase_ai')).toBeInTheDocument();
  });

  it('shows a photo source label for photo imports', () => {
    render(
      <ImportQueue
        items={[{ ...base, kind: 'photo', sourceUrl: null }]}
        onDismiss={noop}
        onView={noop}
      />,
    );
    expect(screen.getByText('import.queue_source_photo')).toBeInTheDocument();
  });

  it('fires onView for a done import', () => {
    const onView = vi.fn();
    render(
      <ImportQueue
        items={[{ ...base, status: 'done', phase: null, recipeId: 'r9' }]}
        onDismiss={noop}
        onView={onView}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'import.ready_view_recipe' }));
    expect(onView).toHaveBeenCalledWith(expect.objectContaining({ jobId: 'j1', recipeId: 'r9' }));
  });

  it('shows the failed status and dismisses', () => {
    const onDismiss = vi.fn();
    render(
      <ImportQueue
        items={[{ ...base, status: 'failed', phase: null }]}
        onDismiss={onDismiss}
        onView={noop}
      />,
    );
    expect(screen.getByText('import.queue_status_failed')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('import.queue_dismiss_aria'));
    expect(onDismiss).toHaveBeenCalledWith('j1');
  });
});
