import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SearchBar } from './SearchBar';

describe('SearchBar', () => {
  it('renders with role=search and exposes an input', () => {
    render(<SearchBar value="" onChange={() => {}} />);
    expect(screen.getByRole('search')).toBeInTheDocument();
    expect(screen.getByLabelText(/search query/i)).toBeInTheDocument();
  });

  it('eventually calls onChange after the debounce', async () => {
    const fn = vi.fn();
    const user = userEvent.setup();
    render(<SearchBar value="" onChange={fn} />);
    await user.type(screen.getByLabelText(/search query/i), 'tom');
    await new Promise((r) => setTimeout(r, 250));
    expect(fn).toHaveBeenCalledWith('tom');
  });

  it('shows the spinner only when loading', () => {
    const { rerender } = render(<SearchBar value="x" onChange={() => {}} loading={false} />);
    expect(document.querySelector('.animate-spin')).toBeNull();
    rerender(<SearchBar value="x" onChange={() => {}} loading />);
    expect(document.querySelector('.animate-spin')).not.toBeNull();
  });
});
