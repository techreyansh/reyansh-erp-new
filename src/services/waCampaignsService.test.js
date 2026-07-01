import { isValidStatusTransition } from './waCampaignsService';

describe('isValidStatusTransition', () => {
  test('draft can move to scheduled or running', () => {
    expect(isValidStatusTransition('draft', 'scheduled')).toBe(true);
    expect(isValidStatusTransition('draft', 'running')).toBe(true);
  });

  test('running can move to paused, stopped, or completed', () => {
    expect(isValidStatusTransition('running', 'paused')).toBe(true);
    expect(isValidStatusTransition('running', 'stopped')).toBe(true);
    expect(isValidStatusTransition('running', 'completed')).toBe(true);
  });

  test('paused can move to running or stopped', () => {
    expect(isValidStatusTransition('paused', 'running')).toBe(true);
    expect(isValidStatusTransition('paused', 'stopped')).toBe(true);
  });

  test('rejects invalid transitions', () => {
    expect(isValidStatusTransition('draft', 'completed')).toBe(false);
    expect(isValidStatusTransition('completed', 'running')).toBe(false);
    expect(isValidStatusTransition('stopped', 'running')).toBe(false);
    expect(isValidStatusTransition('paused', 'completed')).toBe(false);
  });

  test('terminal states (completed/stopped/failed) and scheduled have no forward transition', () => {
    ['completed', 'stopped', 'failed', 'scheduled'].forEach((from) => {
      expect(isValidStatusTransition(from, 'running')).toBe(false);
    });
  });

  test('no-op (same status) and missing values are rejected', () => {
    expect(isValidStatusTransition('running', 'running')).toBe(false);
    expect(isValidStatusTransition(null, 'running')).toBe(false);
    expect(isValidStatusTransition('running', null)).toBe(false);
  });
});
