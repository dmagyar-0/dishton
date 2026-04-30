import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { UnitToggle } from './UnitToggle';

describe('UnitToggle', () => {
  it('renders both options with aria-pressed reflecting value', () => {
    render(<UnitToggle value="metric" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Metric' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Imperial' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('fires onChange with new value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<UnitToggle value="metric" onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Imperial' }));
    expect(onChange).toHaveBeenCalledWith('imperial');
  });

  it('exposes the group label', () => {
    render(<UnitToggle value="metric" onChange={() => {}} />);
    expect(screen.getByRole('group', { name: 'Unit system' })).toBeInTheDocument();
  });
});
