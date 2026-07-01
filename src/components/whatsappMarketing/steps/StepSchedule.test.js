// Focused RTL test for StepSchedule's business-hours validation — the Task 5
// review carry-forward this task must honor: business_hours_end must be
// strictly greater than business_hours_start, blocked inline in the UI.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import StepSchedule from './StepSchedule';

function Harness({ initial }) {
  const [campaign, setCampaign] = React.useState(initial);
  return <StepSchedule campaign={campaign} onChange={(patch) => setCampaign((c) => ({ ...c, ...patch }))} />;
}

describe('StepSchedule — business hours validation', () => {
  test('shows no error for a valid window (9 -> 18)', () => {
    render(<Harness initial={{ business_hours_start: 9, business_hours_end: 18, working_days_only: true }} />);
    expect(screen.queryByText(/end hour must be later/i)).not.toBeInTheDocument();
  });

  test('blocks with an inline error when end === start', () => {
    render(<Harness initial={{ business_hours_start: 9, business_hours_end: 9, working_days_only: true }} />);
    expect(screen.getByText(/end hour must be later than the start hour/i)).toBeInTheDocument();
  });

  test('blocks with an inline error when end < start', () => {
    render(<Harness initial={{ business_hours_start: 18, business_hours_end: 9, working_days_only: true }} />);
    expect(screen.getByText(/end hour must be later than the start hour/i)).toBeInTheDocument();
  });

  test('changing the end hour to something valid clears the error', () => {
    render(<Harness initial={{ business_hours_start: 9, business_hours_end: 9, working_days_only: true }} />);
    expect(screen.getByText(/end hour must be later/i)).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByLabelText(/end hour/i));
    const option = screen.getByRole('option', { name: '18:00' });
    fireEvent.click(option);

    expect(screen.queryByText(/end hour must be later/i)).not.toBeInTheDocument();
  });

  test('working-days-only toggle calls onChange', () => {
    render(<Harness initial={{ business_hours_start: 9, business_hours_end: 18, working_days_only: true }} />);
    const toggle = screen.getByRole('checkbox', { name: /working days only/i });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(toggle).not.toBeChecked();
  });
});
