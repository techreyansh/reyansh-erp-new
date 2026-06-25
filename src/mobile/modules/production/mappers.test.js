import { logOutputIntent } from './mappers';

describe('production mappers — logOutputIntent', () => {
  test('maps stage + output/reject to the ppc_post_jobcard intent', () => {
    const i = logOutputIntent({ id: 'stage-1' }, { output: 120, reject: 5 });
    expect(i.rpc).toBe('ppc_post_jobcard');
    expect(i.args.p_stage_id).toBe('stage-1');
    expect(i.args.p_output).toBe(120);
    expect(i.args.p_reject).toBe(5);
  });

  test('coerces garbage/negative qty to 0', () => {
    const i = logOutputIntent({ id: 's' }, { output: 'abc', reject: -3 });
    expect(i.args.p_output).toBe(0);
    expect(i.args.p_reject).toBe(0);
  });

  test('null stage id when the stage has none', () => {
    expect(logOutputIntent({}, { output: 10 }).args.p_stage_id).toBeNull();
  });
});
