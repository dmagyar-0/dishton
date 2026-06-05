import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

// i18n: echo the key so assertions don't depend on a translation bundle.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

import { SearchBar } from './SearchBar';

describe('SearchBar', () => {
  it('renders with role=search and exposes an input', () => {
    render(<SearchBar value="" onChange={() => {}} />);
    expect(screen.getByRole('search')).toBeInTheDocument();
    expect(screen.getByLabelText('search.query_label')).toBeInTheDocument();
  });

  it('eventually calls onChange after the debounce', async () => {
    const fn = vi.fn();
    const user = userEvent.setup();
    render(<SearchBar value="" onChange={fn} />);
    await user.type(screen.getByLabelText('search.query_label'), 'tom');
    await new Promise((r) => setTimeout(r, 250));
    expect(fn).toHaveBeenCalledWith('tom');
  });

  it('shows the spinner only when loading', () => {
    const { rerender } = render(<SearchBar value="x" onChange={() => {}} loading={false} />);
    expect(document.querySelector('.animate-spin')).toBeNull();
    rerender(<SearchBar value="x" onChange={() => {}} loading />);
    expect(document.querySelector('.animate-spin')).not.toBeNull();
  });

  it('shows a clear button only when there is text and clears on click', async () => {
    const fn = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<SearchBar value="" onChange={fn} />);
    expect(screen.queryByLabelText('search.clear')).toBeNull();
    rerender(<SearchBar value="tomato" onChange={fn} />);
    const clear = screen.getByLabelText('search.clear');
    await user.click(clear);
    expect(fn).toHaveBeenCalledWith('');
  });

  it('focuses the input on the "s" shortcut but ignores Ctrl/Cmd+S', async () => {
    const user = userEvent.setup();
    render(<SearchBar value="" onChange={() => {}} />);
    const input = screen.getByLabelText('search.query_label');
    // Blur first so focus is observable.
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard('s');
    expect(document.activeElement).toBe(input);

    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard('{Control>}s{/Control}');
    expect(document.activeElement).not.toBe(input);
  });
});
