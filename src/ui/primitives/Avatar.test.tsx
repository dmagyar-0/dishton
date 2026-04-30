import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Avatar } from './Avatar';

describe('Avatar', () => {
  it('renders an image when src is provided', () => {
    render(<Avatar src="/x.png" alt="Tom" name="Tom" />);
    const img = screen.getByRole('img', { name: 'Tom' });
    expect(img).toHaveAttribute('src', '/x.png');
  });

  it('falls back to initials when no src', () => {
    render(<Avatar name="Sarah Brown" />);
    expect(screen.getByText('SB')).toBeInTheDocument();
  });

  it('renders question mark with no name and no src', () => {
    render(<Avatar />);
    expect(screen.getByText('?')).toBeInTheDocument();
  });
});
