import { useState, useEffect, useCallback } from 'react';
import type { InterceptRule, PausedRequest } from '../lib/types';
import { api } from '../lib/api';
import { methodColor, METHODS } from '../lib/utils';

interface Props {
  showToast: (msg: string) => void;
}

const actionColors: Record<string, string> = {
  pause: 'bg-warning/15 text-warning',
  'modify-request': 'bg-info/15 text-info',
  'modify-response': 'bg-orange/15 text-orange',
  mock: 'bg-purple/15 text-purple',
};

export function InterceptsTab({ showToast }: Props) {
  const [rules, setRules] = useState<InterceptRule[]>([]);
  const [paused, setPaused] = useState<PausedRequest[]>([]);
  const [editingPaused, setEditingPaused] = useState<PausedRequest | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [rulesList, pausedList] = await Promise.all([api.fetchIntercepts(), api.fetchPaused()]);
      setRules(rulesList);
      setPaused(pausedList);
    } catch {}
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const toggleRule = async (rule: InterceptRule) => {
    try {
      await api.updateIntercept(rule.id, { ...rule, enabled: !rule.enabled });
      refresh();
    } catch (e: any) { showToast('Error: ' + e.message); }
  };

  const deleteRule = async (id: number) => {
    try { await api.deleteIntercept(id); refresh(); } catch (e: any) { showToast('Error: ' + e.message); }
  };

  const resumeReq = async (id: string) => {
    try { await api.resume(id); showToast('Resumed'); refresh(); } catch (e: any) { showToast('Error: ' + e.message); }
  };

  const inputCls = "bg-input-bg border border-dim rounded-lg px-3 py-1.5 text-xs text-input-text outline-none focus:border-accent";
  const selectCls = "bg-input-bg border border-dim rounded-lg px-2 py-1.5 text-xs text-input-text outline-none focus:border-accent";

  const [form, setForm] = useState({ pattern: '', action: 'pause', methods: '', latency: '', status: '', headers: '', body: '' });

  const addRule = async () => {
    if (!form.pattern) { showToast('Path pattern required'); return; }
    const methods = form.methods ? form.methods.split(',').map(str => str.trim()).filter(Boolean) : [];
    const setHeaders: Record<string, string> = {};
    form.headers.split('\n').forEach(line => {
      const idx = line.indexOf(':');
      if (idx > 0) setHeaders[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    });
    try {
      await api.addIntercept({
        path_pattern: form.pattern, methods, action: form.action,
        set_headers: Object.keys(setHeaders).length ? setHeaders : undefined,
        set_status: parseInt(form.status) || undefined,
        set_body: form.body || undefined,
        add_latency_ms: parseInt(form.latency) || undefined,
        enabled: true,
      });
      showToast('Rule added');
      setForm({ pattern: '', action: 'pause', methods: '', latency: '', status: '', headers: '', body: '' });
      refresh();
    } catch (e: any) { showToast('Failed: ' + e.message); }
  };

  return (
    <div>
      {paused.map(pausedRequest => (
        <div key={pausedRequest.id} className="bg-warning/10 border border-warning/30 rounded-lg px-4 py-3 mb-2">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <span className="text-warning">⏸</span>
              <span className={`px-1.5 py-0.5 rounded text-[.7rem] mono font-bold ${methodColor(pausedRequest.method || 'GET')}`}>{pausedRequest.method || '?'}</span>
              <code className="mono text-sm">{pausedRequest.path || pausedRequest.id}</code>
            </span>
            <span className="flex gap-1.5">
              <button onClick={() => setEditingPaused(pausedRequest)} className="text-xs px-3 py-1.5 rounded-lg bg-input-bg text-input-text border-none cursor-pointer hover:bg-dim">✎ Edit & Resume</button>
              <button onClick={() => resumeReq(pausedRequest.id)} className="text-xs px-3 py-1.5 rounded-lg bg-input-bg text-input-text border-none cursor-pointer hover:bg-dim">▶ Resume</button>
            </span>
          </div>
          {pausedRequest.headers && (
            <div className="mt-2 text-xs text-dim">
              Headers: {Object.keys(pausedRequest.headers).length} keys
            </div>
          )}
        </div>
      ))}

      <div className="text-[.7rem] text-muted uppercase tracking-wider mb-2">Active Rules</div>
      {rules.length === 0 ? (
        <div className="text-dim text-center py-8">No intercept rules. Create one below.</div>
      ) : (
        rules.map(rule => (
          <div key={rule.id} className={`bg-surface border border-border rounded-xl px-4 py-3 mb-2 flex items-center gap-3 ${!rule.enabled ? 'opacity-50' : ''}`}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="mono text-sm text-accent">{rule.path_pattern}</span>
                {rule.methods?.length ? <span className="text-muted text-[.7rem]">{rule.methods.join(', ')}</span> : null}
                {rule.add_latency_ms ? <span className="text-dim text-[.65rem]">+{rule.add_latency_ms}ms</span> : null}
              </div>
            </div>
            <span className={`text-[.7rem] px-1.5 py-0.5 rounded font-semibold ${actionColors[rule.action] ?? ''}`}>{rule.action}</span>
            <button onClick={() => toggleRule(rule)} className="text-[.7rem] px-2 py-1 rounded-md bg-input-bg text-input-text border-none cursor-pointer">{rule.enabled ? 'Disable' : 'Enable'}</button>
            <button onClick={() => deleteRule(rule.id)} className="text-[.7rem] px-2 py-1 rounded-md bg-danger/15 text-danger border-none cursor-pointer hover:bg-danger/25">✕</button>
          </div>
        ))
      )}

      <div className="bg-surface border border-border rounded-xl p-5 mt-4">
        <div className="text-[.7rem] text-muted uppercase tracking-wider mb-2">Add Intercept Rule</div>
        <div className="flex gap-2 mb-3">
          <input className={`${inputCls} flex-2`} placeholder="Path regex, e.g. /api/.*" value={form.pattern} onChange={e => setForm(prev => ({ ...prev, pattern: e.target.value }))} />
          <select className={`${selectCls} w-40`} value={form.action} onChange={e => setForm(prev => ({ ...prev, action: e.target.value }))}>
            <option value="pause">Pause (breakpoint)</option>
            <option value="modify-request">Modify Request</option>
            <option value="modify-response">Modify Response</option>
            <option value="mock">Mock Response</option>
          </select>
        </div>
        <div className="flex gap-2 mb-3">
          <input className={`${inputCls} flex-1`} placeholder="Methods (comma-sep, empty=all)" value={form.methods} onChange={e => setForm(prev => ({ ...prev, methods: e.target.value }))} />
          <input className={`${inputCls} w-36`} placeholder="Add latency (ms)" type="number" min="0" value={form.latency} onChange={e => setForm(prev => ({ ...prev, latency: e.target.value }))} />
          <input className={`${inputCls} w-32`} placeholder="Override status" type="number" value={form.status} onChange={e => setForm(prev => ({ ...prev, status: e.target.value }))} />
        </div>
        <div className="text-[.7rem] text-muted uppercase tracking-wider mb-1">Override Headers <span className="text-dim">(one per line, Key: Value)</span></div>
        <textarea className="w-full min-h-16 bg-input-bg border border-dim rounded-lg px-3 py-2 mono text-sm text-input-text resize-y outline-none focus:border-accent mb-2" placeholder="X-Custom: value" value={form.headers} onChange={e => setForm(prev => ({ ...prev, headers: e.target.value }))} />
        <div className="text-[.7rem] text-muted uppercase tracking-wider mb-1">Override Body</div>
        <textarea className="w-full min-h-16 bg-input-bg border border-dim rounded-lg px-3 py-2 mono text-sm text-input-text resize-y outline-none focus:border-accent mb-3" placeholder='{"mocked": true}' value={form.body} onChange={e => setForm(prev => ({ ...prev, body: e.target.value }))} />
        <button onClick={addRule} className="bg-accent text-white px-5 py-2 rounded-lg text-sm font-semibold border-none cursor-pointer hover:opacity-90">Add Rule</button>
      </div>

      {editingPaused && (
        <EditResumeModal
          paused={editingPaused}
          onClose={() => setEditingPaused(null)}
          showToast={showToast}
          onDone={() => { setEditingPaused(null); refresh(); }}
        />
      )}
    </div>
  );
}

function EditResumeModal({ paused, onClose, showToast, onDone }: {
  paused: PausedRequest; onClose: () => void; showToast: (msg: string) => void; onDone: () => void;
}) {
  const [method, setMethod] = useState(paused.method || 'GET');
  const [path, setPath] = useState(paused.path || '/');
  const [headersText, setHeadersText] = useState(() => {
    if (!paused.headers) return '';
    return Object.entries(paused.headers).map(([key, value]) => key + ': ' + (Array.isArray(value) ? value.join(', ') : value)).join('\n');
  });
  const [body, setBody] = useState(() => {
    if (!paused.body) return '';
    try { return atob(paused.body); } catch { return paused.body; }
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async () => {
    const headers: Record<string, string[]> = {};
    headersText.split('\n').forEach(line => {
      const idx = line.indexOf(':');
      if (idx > 0) {
        const key = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();
        if (!headers[key]) headers[key] = [];
        headers[key].push(value);
      }
    });
    try {
      await api.resume(paused.id, { method, path, headers, body });
      showToast('Resumed with edits');
      onDone();
    } catch (e: any) { showToast('Error: ' + e.message); }
  };

  const inputCls = "bg-input-bg border border-dim rounded-lg px-3 py-1.5 text-xs text-input-text outline-none focus:border-accent";
  const selectCls = "bg-input-bg border border-dim rounded-lg px-2 py-1.5 text-xs text-input-text outline-none focus:border-accent";

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center backdrop-blur-sm" onClick={onClose}>
      <div className="bg-bg border border-border rounded-xl w-[90vw] max-w-[650px] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <span className="text-warning">⏸</span>
            <span className="text-sm font-semibold">Edit Paused Request</span>
          </div>
          <button onClick={onClose} className="bg-transparent border-none text-muted cursor-pointer text-xl px-1 leading-none hover:text-text" aria-label="Close">&times;</button>
        </div>
        <div className="p-5">
          <div className="flex gap-2 mb-3">
            <select className={`${selectCls} w-[100px]`} value={method} onChange={e => setMethod(e.target.value)}>
              {METHODS.map(method => <option key={method}>{method}</option>)}
            </select>
            <input className={`${inputCls} flex-1`} value={path} onChange={e => setPath(e.target.value)} />
          </div>
          <div className="text-[.7rem] text-muted uppercase tracking-wider mb-1">Headers</div>
          <textarea
            className="w-full min-h-20 bg-input-bg border border-dim rounded-lg px-3 py-2 mono text-sm text-input-text resize-y outline-none focus:border-accent mb-2"
            value={headersText}
            onChange={e => setHeadersText(e.target.value)}
          />
          <div className="text-[.7rem] text-muted uppercase tracking-wider mb-1">Body</div>
          <textarea
            className="w-full min-h-20 bg-input-bg border border-dim rounded-lg px-3 py-2 mono text-sm text-input-text resize-y outline-none focus:border-accent mb-3"
            value={body}
            onChange={e => setBody(e.target.value)}
          />
          <div className="flex gap-2">
            <button onClick={submit} className="bg-accent text-white px-5 py-2 rounded-lg text-sm font-semibold border-none cursor-pointer hover:opacity-90">▶ Resume with Changes</button>
            <button onClick={onClose} className="text-xs px-3 py-1.5 rounded-lg bg-input-bg text-input-text border-none cursor-pointer hover:bg-dim">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
