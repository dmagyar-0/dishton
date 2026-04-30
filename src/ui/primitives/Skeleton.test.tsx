import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Skeleton } from './Skeleton';

describe('Skeleton', () => {
  it('renders a hidden block', () => {
    render(<Skeleton />);
    const el = screen.getByTestId('skeleton');
    expect(el).toHaveAttribute('aria-hidden', 'true');
  });

  it('merges className', () => {
    render(<Skeleton className="h-10 w-10" />);
    const el = screen.getByTestId('skeleton');
    expect(el).toHaveClass('h-10', 'w-10');
  });
});
