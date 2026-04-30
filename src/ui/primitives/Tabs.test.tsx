import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Tabs, TabsContent, TabsList, TabsTrigger } from './Tabs';

function Harness() {
  return (
    <Tabs defaultValue="one">
      <TabsList>
        <TabsTrigger value="one">One</TabsTrigger>
        <TabsTrigger value="two">Two</TabsTrigger>
      </TabsList>
      <TabsContent value="one">Body 1</TabsContent>
      <TabsContent value="two">Body 2</TabsContent>
    </Tabs>
  );
}

describe('Tabs', () => {
  it('renders tablist and tabs', () => {
    render(<Harness />);
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(2);
  });

  it('shows the active panel', () => {
    render(<Harness />);
    expect(screen.getByText('Body 1')).toBeInTheDocument();
    expect(screen.queryByText('Body 2')).not.toBeInTheDocument();
  });

  it('navigates with ArrowRight', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const t1 = screen.getByRole('tab', { name: 'One' });
    t1.focus();
    await user.keyboard('{ArrowRight}');
    const t2 = screen.getByRole('tab', { name: 'Two' });
    expect(t2).toHaveAttribute('data-state', 'active');
  });
});
