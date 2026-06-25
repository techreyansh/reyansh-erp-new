import { advance, isDue, dueEnrollments, matchTrigger, autoEnrollPlan, currentStep } from './kitWorkflowEngine';

const wf = {
  id: 'w1', is_active: true, trigger_type: 'no_interaction_30d', trigger_config: { days: 30 },
  steps: [
    { channel: 'whatsapp', category: 'intro', wait_days: 0 },
    { channel: 'whatsapp', category: 'insight', wait_days: 3 },
    { channel: 'email', category: 'offer', wait_days: 7 },
  ],
};

test('currentStep returns the step at current_step', () => {
  expect(currentStep({ current_step: 0 }, wf).category).toBe('intro');
  expect(currentStep({ current_step: 2 }, wf).category).toBe('offer');
});

test('advance moves to next step with wait-based due date', () => {
  const p = advance({ current_step: 0 }, wf, '2026-06-22');
  expect(p.current_step).toBe(1);
  expect(p.status).toBe('active');
  expect(p.next_due_date).toBe('2026-06-25'); // +3
});

test('advance past last step completes the enrollment', () => {
  const p = advance({ current_step: 2 }, wf, '2026-06-22');
  expect(p.status).toBe('completed');
  expect(p.next_due_date).toBeNull();
  expect(p.completed_at).toBe('2026-06-22');
});

test('isDue / dueEnrollments select active+past-due only', () => {
  const list = [
    { id: 'a', status: 'active', next_due_date: '2026-06-20' },
    { id: 'b', status: 'active', next_due_date: '2026-06-30' },
    { id: 'c', status: 'completed', next_due_date: '2026-06-01' },
    { id: 'd', status: 'active', next_due_date: '2026-06-22' },
  ];
  expect(isDue(list[0], '2026-06-22')).toBe(true);
  expect(isDue(list[1], '2026-06-22')).toBe(false);
  const due = dueEnrollments(list, '2026-06-22');
  expect(due.map((e) => e.id)).toEqual(['a', 'd']);
});

test('matchTrigger respects trigger type + threshold', () => {
  expect(matchTrigger({ days_since_touch: 40 }, wf)).toBe(true);
  expect(matchTrigger({ days_since_touch: 10 }, wf)).toBe(false);
  expect(matchTrigger({ days_since_touch: 40 }, { ...wf, is_active: false })).toBe(false);
});

test('autoEnrollPlan enrolls matching, skips already-enrolled', () => {
  const contacts = [
    { account_id: 'x', company_name: 'X Co', days_since_touch: 50 },
    { account_id: 'y', company_name: 'Y Co', days_since_touch: 5 },
    { account_id: 'z', company_name: 'Z Co', days_since_touch: 99 },
  ];
  const existing = [{ workflow_id: 'w1', account_id: 'z' }];
  const plan = autoEnrollPlan(contacts, wf, existing, '2026-06-22');
  expect(plan.map((p) => p.account_id)).toEqual(['x']);
  expect(plan[0]).toMatchObject({ workflow_id: 'w1', current_step: 0, status: 'active', next_due_date: '2026-06-22' });
});
