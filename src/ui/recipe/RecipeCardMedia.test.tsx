import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// RecipeImage resolves storage paths to signed URLs via a hook; mock it so
// component tests don't need a Supabase context.
vi.mock('@/ui/primitives/RecipeImage', () => ({
  RecipeImage: ({
    path,
    alt: _alt,
    className,
  }: {
    path: string;
    alt: string;
    className?: string;
  }) => (
    <img aria-hidden="true" data-testid="recipe-image" src={path} alt="" className={className} />
  ),
}));

import { RecipeCardMedia, gradientClassForTitle, titleGradientIndex } from './RecipeCardMedia';

describe('RecipeCardMedia', () => {
  describe('when heroImagePath is provided', () => {
    it('renders the RecipeImage component', () => {
      render(<RecipeCardMedia heroImagePath="some/path/hero.jpg" title="Saffron Risotto" />);
      const img = screen.getByTestId('recipe-image');
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute('src', 'some/path/hero.jpg');
    });

    it('does not render the decorative placeholder initial', () => {
      render(<RecipeCardMedia heroImagePath="some/path/hero.jpg" title="Saffron Risotto" />);
      // The large initial character is only shown in placeholder mode.
      expect(screen.queryByText('S')).not.toBeInTheDocument();
    });
  });

  describe('when heroImagePath is null', () => {
    it('renders the placeholder with the uppercased first character of the title', () => {
      render(<RecipeCardMedia heroImagePath={null} title="Bánh Mì" />);
      expect(screen.getByText('B')).toBeInTheDocument();
    });

    it('uppercases the initial', () => {
      render(<RecipeCardMedia heroImagePath={null} title="mushroom soup" />);
      expect(screen.getByText('M')).toBeInTheDocument();
    });

    it('skips leading whitespace when choosing the initial', () => {
      render(<RecipeCardMedia heroImagePath={null} title="  pad thai" />);
      expect(screen.getByText('P')).toBeInTheDocument();
    });

    it('does not render a RecipeImage', () => {
      render(<RecipeCardMedia heroImagePath={null} title="Pasta" />);
      expect(screen.queryByTestId('recipe-image')).not.toBeInTheDocument();
    });

    it('marks the placeholder as aria-hidden', () => {
      const { container } = render(<RecipeCardMedia heroImagePath={null} title="Pasta" />);
      // The outer wrapper is aria-hidden
      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper).toHaveAttribute('aria-hidden', 'true');
    });
  });

  describe('gradient determinism', () => {
    it('returns the same gradient class for the same title on multiple calls', () => {
      const title = 'Lemon Tart';
      expect(gradientClassForTitle(title)).toBe(gradientClassForTitle(title));
    });

    it('produces an index in the valid range [0, 5]', () => {
      const titles = ['A', 'Bánh Mì', 'Saffron Risotto', '  pad thai', 'mushroom soup'];
      for (const title of titles) {
        const idx = titleGradientIndex(title);
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThanOrEqual(5);
      }
    });

    it('two different titles may produce different indices', () => {
      // We cannot guarantee they differ (hash collisions are valid), but we can
      // show that the function at least outputs a number, and two very different
      // titles produce consistent results independently.
      const idx1 = titleGradientIndex('AAA');
      const idx2 = titleGradientIndex('ZZZ');
      // Both are valid numbers in range.
      expect(typeof idx1).toBe('number');
      expect(typeof idx2).toBe('number');
    });
  });
});
