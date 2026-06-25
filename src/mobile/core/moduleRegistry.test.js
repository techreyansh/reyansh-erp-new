import { visibleModules, findModule } from './moduleRegistry';

const REGISTRY = [
  {
    key: 'store',
    title: 'Store',
    requiredModule: 'inventory',
    screens: [
      { key: 'receive', title: 'Receive' },
      { key: 'issue', title: 'Issue', cap: 'store.issue' },
    ],
  },
  {
    key: 'quality',
    title: 'Quality',
    requiredModule: 'quality',
    cap: 'quality.access',
    screens: [{ key: 'hold', title: 'Hold' }],
  },
  { key: 'noreq', title: 'No Requirement', requiredModule: '', screens: [] },
];

describe('visibleModules', () => {
  it('hides modules whose requiredModule the user cannot view', () => {
    const access = { modules: [{ module_key: 'inventory', can_view: true }] };
    const visible = visibleModules(REGISTRY, access, []);
    const keys = visible.map((m) => m.key);
    expect(keys).toContain('store'); // inventory viewable
    expect(keys).not.toContain('quality'); // quality not viewable
  });

  it('hides a module when its module-level capability is absent', () => {
    const access = {
      modules: [
        { module_key: 'inventory', can_view: true },
        { module_key: 'quality', can_view: true },
      ],
    };
    const withoutCap = visibleModules(REGISTRY, access, []);
    expect(withoutCap.map((m) => m.key)).not.toContain('quality');

    const withCap = visibleModules(REGISTRY, access, ['quality.access']);
    expect(withCap.map((m) => m.key)).toContain('quality');
  });

  it('filters screens by per-screen capability', () => {
    const access = { modules: [{ module_key: 'inventory', can_view: true }] };
    const noIssueCap = visibleModules(REGISTRY, access, []);
    const store = findModule(noIssueCap, 'store');
    expect(store.screens.map((s) => s.key)).toEqual(['receive']); // 'issue' gated out

    const withIssueCap = visibleModules(REGISTRY, access, ['store.issue']);
    const store2 = findModule(withIssueCap, 'store');
    expect(store2.screens.map((s) => s.key)).toEqual(['receive', 'issue']);
  });

  it('treats can_view:false as not viewable', () => {
    const access = { modules: [{ module_key: 'inventory', can_view: false }] };
    expect(visibleModules(REGISTRY, access, []).map((m) => m.key)).not.toContain('store');
  });

  it('shows a module with no requiredModule to everyone', () => {
    const visible = visibleModules(REGISTRY, { modules: [] }, []);
    expect(visible.map((m) => m.key)).toContain('noreq');
  });
});
