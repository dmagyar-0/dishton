import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import { ChatThread } from './ChatThread';

describe('ChatThread', () => {
  it('renders user and agent messages', () => {
    render(
      <ChatThread
        messages={[
          { id: '1', role: 'user', content: 'cozy autumn soup', created_at: '' },
          { id: '2', role: 'agent', content: 'How about a squash soup?', created_at: '' },
        ]}
        thinking={false}
      />,
    );
    expect(screen.getByText('cozy autumn soup')).toBeInTheDocument();
    expect(screen.getByText('How about a squash soup?')).toBeInTheDocument();
  });

  it('shows the thinking indicator when drafting', () => {
    render(<ChatThread messages={[]} thinking={true} />);
    expect(screen.getByText('chat.thinking')).toBeInTheDocument();
  });
});
