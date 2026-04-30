import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('renders title and description', () => {
    render(<EmptyState title="Nothing here" description="Add a recipe to start." />);
    expect(screen.getByRole('heading', { name: 'Nothing here' })).toBeInTheDocument();
    expect(screen.getByText('Add a recipe to start.')).toBeInTheDocument();
  });

  it('renders the action slot', () => {
    render(
      <EmptyState
        title="x"
        action={
          <button type="button" data-testid="cta">
            Add
          </button>
        }
      />,
    );
    expect(screen.getByTestId('cta')).toBeInTheDocument();
  });
});
