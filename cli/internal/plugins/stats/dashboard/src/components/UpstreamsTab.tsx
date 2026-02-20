import { useState, useEffect, useCallback } from 'react';
import type { UpstreamRoute } from '../lib/types';
import { api } from '../lib/api';

interface Props {
  subdomain: string;
  showToast: (msg: string) => void;
}

const empty: Partial<UpstreamRoute> = {
  subdomain: '*',
  path_pattern: '.*',
  methods: [],
  target: '',
  enabled: true,
  priority: 0,
};

export function UpstreamsTab({ subdomain, showToast }: Props) {
  const [routes, setRoutes] = useState<UpstreamRoute[]>([]);
  const [form, setForm] = useState<Partial<UpstreamRoute>>({ ...empty, subdomain });
  const [editId, setEditId] = useState<number | null>(null);

  const refresh = useCallback(() => {
    api.fetchUpstreams().then(setRoutes).catch(() => {});
  }, []);

  useEffect(refresh, [refresh]);

  const save = async () => {
    if (!form.target?.trim()) { showToast('Target URL required'); return; }
    try {
      if (editId != null) {
        await api.updateUpstream(editId, form);
        showToast('Route updated');
      } else {
        await api.addUpstream(form);
        showToast('Route added');
      }
      setForm({ ...empty, subdomain });
      setEditId(null);
      refresh();
    } catch (e: any) {
      showToast(e.message || 'Error');
    }
  };

  const startEdit = (r: UpstreamRoute) => {
    setEditId(r.id);
    setForm({ subdomain: r.subdomain, path_pattern: r.path_pattern, methods: r.methods, target: r.target, enabled: r.enabled, priority: r.priority });
  };

  const remove = async (id: number) => {
    await api.deleteUpstream(id);
    showToast('Route deleted');
    refresh();
  };

  const toggle = async (r: UpstreamRoute) => {
    await api.updateUpstream(r.id, { ...r, enabled: !r.enabled });
    refresh();
  };

  return (
    <div>
      {/* Form */}
      <div className="bg-surface border border-border rounded-xl p-4 mb-4">
        <div className="text-sm font-bold mb-3">{editId != null ? 'Edit Route' : 'Add Upstream Route'}</div>
        <div className="grid grid-cols-[1fr_1fr_auto_1fr_auto] gap-2 items-end">
          <div>
            <label className="text-[.65rem] text-muted block mb-1">Subdomain</label>
            <input
              value={form.subdomain || ''}
              onChange={e => setForm(f => ({ ...f, subdomain: e.target.value }))}
              placeholder="* (all)"
              className="w-full text-xs px-2 py-1.5 rounded bg-input-bg border border-border text-text mono"
            />
          </div>
          <div>
            <label className="text-[.65rem] text-muted block mb-1">Path Pattern (regex)</label>
            <input
              value={form.path_pattern || ''}
              onChange={e => setForm(f => ({ ...f, path_pattern: e.target.value }))}
              placeholder=".*"
              className="w-full text-xs px-2 py-1.5 rounded bg-input-bg border border-border text-text mono"
            />
          </div>
          <div>
            <label className="text-[.65rem] text-muted block mb-1">Priority</label>
            <input
              type="number"
              value={form.priority ?? 0}
              onChange={e => setForm(f => ({ ...f, priority: Number(e.target.value) }))}
              className="w-16 text-xs px-2 py-1.5 rounded bg-input-bg border border-border text-text mono"
            />
          </div>
          <div>
            <label className="text-[.65rem] text-muted block mb-1">Target URL</label>
            <input
              value={form.target || ''}
              onChange={e => setForm(f => ({ ...f, target: e.target.value }))}
              placeholder="https://api.prod.com"
              className="w-full text-xs px-2 py-1.5 rounded bg-input-bg border border-border text-text mono"
            />
          </div>
          <div className="flex gap-1">
            <button onClick={save} className="text-xs px-3 py-1.5 rounded-lg bg-accent text-white border-none cursor-pointer">
              {editId != null ? 'Update' : 'Add'}
            </button>
            {editId != null && (
              <button onClick={() => { setEditId(null); setForm({ ...empty, subdomain }); }} className="text-xs px-3 py-1.5 rounded-lg bg-dim text-muted border-none cursor-pointer">
                Cancel
              </button>
            )}
          </div>
        </div>
        <div className="mt-2">
          <label className="text-[.65rem] text-muted block mb-1">Methods (comma-separated, empty = all)</label>
          <input
            value={(form.methods || []).join(', ')}
            onChange={e => setForm(f => ({ ...f, methods: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))}
            placeholder="GET, POST (empty = all)"
            className="w-full text-xs px-2 py-1.5 rounded bg-input-bg border border-border text-text mono"
          />
        </div>
      </div>

      {/* Routes list */}
      {routes.length === 0 ? (
        <div className="text-center text-dim text-sm py-8">
          No upstream routes. All traffic goes to localhost.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {routes.map(r => (
            <div key={r.id} className={`bg-surface border rounded-xl p-3 flex items-center gap-3 ${r.enabled ? 'border-accent/30' : 'border-border opacity-60'}`}>
              <button
                onClick={() => toggle(r)}
                className={`w-8 h-4 rounded-full border-none cursor-pointer relative transition-colors ${r.enabled ? 'bg-accent' : 'bg-dim'}`}
              >
                <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${r.enabled ? 'left-[16px]' : 'left-0.5'}`} />
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-xs">
                  <span className="mono font-bold">{r.subdomain === '*' ? 'all tunnels' : r.subdomain}</span>
                  <span className="text-muted">→</span>
                  <span className="mono text-accent truncate">{r.target}</span>
                </div>
                <div className="flex gap-3 text-[.65rem] text-muted mt-0.5">
                  <span>path: <span className="mono">{r.path_pattern}</span></span>
                  {r.methods && r.methods.length > 0 && <span>methods: {r.methods.join(', ')}</span>}
                  <span>priority: {r.priority}</span>
                </div>
              </div>
              <button onClick={() => startEdit(r)} className="text-xs px-2 py-1 rounded bg-input-bg text-muted border-none cursor-pointer hover:text-text">
                Edit
              </button>
              <button onClick={() => remove(r.id)} className="text-xs px-2 py-1 rounded bg-input-bg text-danger border-none cursor-pointer hover:bg-danger/20">
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
