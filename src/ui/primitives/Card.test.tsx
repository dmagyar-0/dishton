import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Card } from './Card';

describe('Card', () => {
  it('renders as a div by default', () => {
    render(<Card data-testid="c">Hello</Card>);
    const el = screen.getByTestId('c');
    expect(el.tagName).toBe('DIV');
    expect(el).toHaveTextContent('Hello');
  });

  it('changes element via as prop', () => {
    render(
      <Card as="article" data-testid="c">
        Body
      </Card>,
    );
    expect(screen.getByTestId('c').tagName).toBe('ARTICLE');
  });

  it('merges className with default', () => {
    render(<Card className="custom-x" data-testid="c" />);
    const el = screen.getByTestId('c');
    expect(el).toHaveClass('custom-x');
    expect(el).toHaveClass('bg-paper-2');
    expect(el).toHaveClass('shadow-press');
  });
});
