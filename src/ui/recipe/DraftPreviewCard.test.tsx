import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import { DraftPreviewCard } from './DraftPreviewCard';

const draft = {
  title: 'Saffron Risotto',
  description: 'Creamy and bright.',
  source_type: 'manual',
  source_url: null,
  source_language: 'en',
  canonical_unit_system: 'metric',
  servings: 2,
  total_time_min: 40,
  hero_image_path: null,
  tags: ['comfort'],
  ingredients: [
    {
      position: 0,
      raw_text: '200 g rice',
      quantity: 200,
      unit: 'g',
      ingredient_name: 'rice',
      notes: null,
      scalable: true,
      non_scalable_qty: null,
      section: null,
    },
  ],
  steps: [{ position: 0, body: 'Toast the rice.', duration_min: 5 }],
} as const;

describe('DraftPreviewCard', () => {
  it('renders the draft title, a tag, and a step', () => {
    render(<DraftPreviewCard draft={draft as never} />);
    expect(screen.getByText('Saffron Risotto')).toBeInTheDocument();
    expect(screen.getByText('comfort')).toBeInTheDocument();
    expect(screen.getByText('rice')).toBeInTheDocument();
    expect(screen.getByText('Toast the rice.')).toBeInTheDocument();
  });
});
