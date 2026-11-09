import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Badge, Callout, EmptyState, Stat, Tabs } from './Primitives';
import { Button } from './Button';

describe('Button', () => {
  it('renders its label and fires on click', async () => {
    let clicks = 0;
    render(<Button onClick={() => { clicks += 1; }}>Run</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(clicks).toBe(1);
  });

  it('does not fire while loading, and marks itself busy', async () => {
    let clicks = 0;
    render(
      <Button loading onClick={() => { clicks += 1; }}>
        Run
      </Button>,
    );
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(button);
    expect(clicks).toBe(0);
  });

  it('does not fire when disabled', async () => {
    let clicks = 0;
    render(
      <Button disabled onClick={() => { clicks += 1; }}>
        Submit
      </Button>,
    );
    await userEvent.click(screen.getByRole('button'));
    expect(clicks).toBe(0);
  });
});

describe('Badge', () => {
  it('renders its content', () => {
    render(<Badge tone="success">Succeeded</Badge>);
    expect(screen.getByText('Succeeded')).toBeInTheDocument();
  });
});

describe('Callout', () => {
  it('renders a title and body', () => {
    render(
      <Callout tone="warning" title="Copilot is not configured">
        Set AI_PROVIDER to enable it.
      </Callout>,
    );
    expect(screen.getByText('Copilot is not configured')).toBeInTheDocument();
    expect(screen.getByText('Set AI_PROVIDER to enable it.')).toBeInTheDocument();
  });
});

describe('EmptyState', () => {
  it('renders the title, body and actions', () => {
    render(
      <EmptyState
        title="No interviews yet"
        body="Create one to get started."
        actions={<Button>New interview</Button>}
      />,
    );
    expect(screen.getByText('No interviews yet')).toBeInTheDocument();
    expect(screen.getByText('Create one to get started.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New interview' })).toBeInTheDocument();
  });
});

describe('Stat', () => {
  it('renders a label, a value and a hint', () => {
    render(<Stat label="Code runs" value="42" hint="last 30 days" />);
    expect(screen.getByText('Code runs')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('last 30 days')).toBeInTheDocument();
  });
});

describe('Tabs', () => {
  function Harness() {
    const [value, setValue] = useState<'tests' | 'console'>('tests');
    return (
      <Tabs
        items={[
          { id: 'tests', label: 'Tests', count: 7 },
          { id: 'console', label: 'Console' },
        ]}
        value={value}
        onChange={setValue}
        ariaLabel="Output"
      />
    );
  }

  it('marks the selected tab and switches on click', async () => {
    render(<Harness />);
    const tests = screen.getByRole('tab', { name: /Tests/ });
    const console_ = screen.getByRole('tab', { name: 'Console' });

    expect(tests).toHaveAttribute('aria-selected', 'true');
    expect(console_).toHaveAttribute('aria-selected', 'false');

    await userEvent.click(console_);
    expect(screen.getByRole('tab', { name: 'Console' })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows a count when one is given', () => {
    render(<Harness />);
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('exposes an accessible name for the tab list', () => {
    render(<Harness />);
    expect(screen.getByRole('tablist')).toHaveAccessibleName('Output');
  });
});
