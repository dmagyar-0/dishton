import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TagStrip } from './TagStrip';

// i18n: echo keys so assertions are bundle-independent.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('TagStrip — full cloud (no collapse prop)', () => {
  it('renders tags with count as a single unit separated by ·', () => {
    render(
      <TagStrip
        tags={[{ tag: 'tomato', n: 3 }, { tag: 'soup' }]}
        selected={[]}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByText('tomato')).toBeInTheDocument();
    // Count is rendered in a sibling span containing "· 3"
    expect(screen.getByText(/·\s*3/)).toBeInTheDocument();
    expect(screen.getByText('soup')).toBeInTheDocument();
  });

  it('toggles selection on click', async () => {
    const fn = vi.fn();
    const user = userEvent.setup();
    render(<TagStrip tags={[{ tag: 'tomato' }]} selected={[]} onToggle={fn} />);
    await user.click(screen.getByText('tomato'));
    expect(fn).toHaveBeenCalledWith('tomato');
  });

  it('marks selected via aria-pressed', () => {
    render(<TagStrip tags={[{ tag: 'soup' }]} selected={['soup']} onToggle={() => {}} />);
    expect(screen.getByText('soup').closest('button')).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows all tags when not collapsed', () => {
    render(
      <TagStrip
        tags={[{ tag: 'chicken' }, { tag: 'baking' }, { tag: 'soup' }]}
        selected={[]}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByText('chicken')).toBeInTheDocument();
    expect(screen.getByText('baking')).toBeInTheDocument();
    expect(screen.getByText('soup')).toBeInTheDocument();
  });

  it('shows the expanded disclosure button when onCollapseToggle is provided', () => {
    render(
      <TagStrip
        tags={[{ tag: 'chicken' }]}
        selected={[]}
        onToggle={() => {}}
        collapsed={false}
        onCollapseToggle={() => {}}
      />,
    );
    const toggle = screen.getByRole('button', { name: /search\.hide_tag_filters/ });
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    // aria-controls must point at the full-cloud panel, not the button's own container.
    const panelId = toggle.getAttribute('aria-controls');
    expect(panelId).toBeTruthy();
    // The panel element must exist in the DOM and have that id.
    if (panelId) {
      expect(document.getElementById(panelId)).toBeInTheDocument();
    }
  });
});

describe('TagStrip — collapsed mode', () => {
  it('hides non-active tags when collapsed', () => {
    render(
      <TagStrip
        tags={[{ tag: 'chicken' }, { tag: 'baking' }, { tag: 'soup' }]}
        selected={['baking']}
        onToggle={() => {}}
        collapsed={true}
        onCollapseToggle={() => {}}
      />,
    );
    // Active tag stays visible
    expect(screen.getByText('baking')).toBeInTheDocument();
    // Inactive tags are hidden
    expect(screen.queryByText('chicken')).not.toBeInTheDocument();
    expect(screen.queryByText('soup')).not.toBeInTheDocument();
  });

  it('shows the disclosure toggle in collapsed state', () => {
    render(
      <TagStrip
        tags={[{ tag: 'chicken' }]}
        selected={[]}
        onToggle={() => {}}
        collapsed={true}
        onCollapseToggle={() => {}}
      />,
    );
    const toggle = screen.getByRole('button', { name: /search\.filter_by_tag/ });
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // aria-controls must reference the same panel id as the expanded button uses.
    // In collapsed mode the panel is not mounted, so we only verify the attribute exists.
    expect(toggle.getAttribute('aria-controls')).toBeTruthy();
  });

  it('calls onCollapseToggle when disclosure toggle is clicked', async () => {
    const onCollapseToggle = vi.fn();
    const user = userEvent.setup();
    render(
      <TagStrip
        tags={[{ tag: 'chicken' }]}
        selected={[]}
        onToggle={() => {}}
        collapsed={true}
        onCollapseToggle={onCollapseToggle}
      />,
    );
    await user.click(screen.getByRole('button', { name: /search\.filter_by_tag/ }));
    expect(onCollapseToggle).toHaveBeenCalledOnce();
  });

  it('active tag chip remains clickable while collapsed', async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    render(
      <TagStrip
        tags={[{ tag: 'baking' }, { tag: 'soup' }]}
        selected={['baking']}
        onToggle={onToggle}
        collapsed={true}
        onCollapseToggle={() => {}}
      />,
    );
    await user.click(screen.getByText('baking'));
    expect(onToggle).toHaveBeenCalledWith('baking');
  });
});
