import {
  poLineToReceiveIntent,
  woLineToIssueIntent,
  woToIssueKitIntent,
  freeIssueIntent,
  countToAdjustIntent,
  transferIntent,
  STORE_LOCATION,
  WIP_LOCATION,
} from './mappers';

describe('poLineToReceiveIntent — open-PO line → inv_receive', () => {
  test('maps lowercase fields + defaults qty to ordered qty and location to STORE', () => {
    const line = { itemCode: 'CO12', quantity: '100', price: '850.5' };
    const { rpc, args } = poLineToReceiveIntent(line, { grnRef: 'GRN-1' });
    expect(rpc).toBe('inv_receive');
    expect(args).toEqual({
      p_item_code: 'CO12',
      p_location_code: STORE_LOCATION,
      p_qty: 100,
      p_rate: 850.5,
      p_ref_id: 'GRN-1',
      p_ref_type: 'grn',
    });
  });

  test('tolerates Capitalised field-name variance (ItemCode/Quantity/Price) and rate fallback', () => {
    const line = { ItemCode: 'PVC9', Quantity: 50, Price: 0 };
    const { args } = poLineToReceiveIntent(line, {});
    expect(args.p_item_code).toBe('PVC9');
    expect(args.p_qty).toBe(50);
    // Price:0 is empty-ish via firstOf → falls back to null (no rate on the line)
    expect(args.p_rate).toBeNull();
  });

  test('ctx.qty (received qty) overrides the ordered qty', () => {
    const line = { itemCode: 'X1', quantity: 100, rate: 10 };
    const { args } = poLineToReceiveIntent(line, { qty: 80, locationCode: 'COPPER' });
    expect(args.p_qty).toBe(80);
    expect(args.p_location_code).toBe('COPPER');
    expect(args.p_rate).toBe(10);
  });

  test('missing item code → null (no crash)', () => {
    const { args } = poLineToReceiveIntent({}, {});
    expect(args.p_item_code).toBeNull();
    expect(args.p_qty).toBe(0);
  });
});

describe('woLineToIssueIntent — WO kit line → inv_issue_kit_line', () => {
  test('uses the wo_material id and numeric qty', () => {
    const { rpc, args } = woLineToIssueIntent({ id: 42, qty_required: 10, qty_issued: 4 }, 6);
    expect(rpc).toBe('inv_issue_kit_line');
    expect(args).toEqual({ p_wo_material_id: 42, p_qty: 6 });
  });

  test('non-numeric qty coerces to 0', () => {
    const { args } = woLineToIssueIntent({ id: 7 }, 'abc');
    expect(args.p_qty).toBe(0);
  });
});

describe('woToIssueKitIntent — full kit → inv_issue_kit', () => {
  test('defaults allow_partial false', () => {
    expect(woToIssueKitIntent(99)).toEqual({
      rpc: 'inv_issue_kit',
      args: { p_wo_id: 99, p_allow_partial: false },
    });
  });
  test('allow_partial true is passed through', () => {
    expect(woToIssueKitIntent(99, true).args.p_allow_partial).toBe(true);
  });
});

describe('freeIssueIntent — ad-hoc issue → inv_issue (STORE→WIP)', () => {
  test('defaults location STORE and ref_type manual_issue', () => {
    const { rpc, args } = freeIssueIntent('CO12', 5);
    expect(rpc).toBe('inv_issue');
    expect(args).toEqual({
      p_item_code: 'CO12',
      p_location_code: STORE_LOCATION,
      p_qty: 5,
      p_ref_id: null,
      p_ref_type: 'manual_issue',
    });
  });
  test('honours a WIP source override + ref', () => {
    const { args } = freeIssueIntent('X', 2, { locationCode: WIP_LOCATION, ref: 'WO-3', refType: 'work_order' });
    expect(args.p_location_code).toBe(WIP_LOCATION);
    expect(args.p_ref_id).toBe('WO-3');
    expect(args.p_ref_type).toBe('work_order');
  });
});

describe('countToAdjustIntent — counted qty → inv_adjust (absolute set)', () => {
  test('builds an absolute new-qty adjust with default reason', () => {
    const { rpc, args } = countToAdjustIntent({ itemCode: 'CO12', locationCode: 'COPPER', countedQty: 73 });
    expect(rpc).toBe('inv_adjust');
    expect(args).toEqual({
      p_item_code: 'CO12',
      p_location_code: 'COPPER',
      p_new_qty: 73,
      p_reason: 'cycle count',
    });
  });
  test('counting to zero is preserved (not treated as missing)', () => {
    const { args } = countToAdjustIntent({ itemCode: 'X', locationCode: 'STORE', countedQty: 0 });
    expect(args.p_new_qty).toBe(0);
  });
});

describe('transferIntent — item from→to → inv_transfer', () => {
  test('maps both locations and qty', () => {
    const { rpc, args } = transferIntent({ itemCode: 'CO12', fromCode: 'STORE', toCode: 'COPPER', qty: 25 });
    expect(rpc).toBe('inv_transfer');
    expect(args).toEqual({
      p_item_code: 'CO12',
      p_from_code: 'STORE',
      p_to_code: 'COPPER',
      p_qty: 25,
      p_ref_id: null,
    });
  });
});
