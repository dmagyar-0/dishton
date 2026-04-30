import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Badge, Tag } from './Badge';

describe('Badge', () => {
  it('renders content with default variant', () => {
    render(<Badge>New</Badge>);
    expect(screen.getByText('New')).toHaveClass('bg-paper-2');
  });

  it('applies secondary variant', () => {
    render(<Badge variant="secondary">x</Badge>);
    expect(screen.getByText('x')).toHaveClass('bg-sage');
  });

  it('Tag is an alias of Badge', () => {
    expect(Tag).toBe(Badge);
  });
});
