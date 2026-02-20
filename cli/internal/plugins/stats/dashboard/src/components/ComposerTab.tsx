import { useState, useEffect } from 'react';
import type { Tunnel, SavedRequest, SendResult, ComposerState } from '../lib/types';
import { api } from '../lib/api';
import { formatBytes, formatLatency, statusColor, methodColor, METHODS } from '../lib/utils';
import type { KVPair } from '../lib/types';

interface Props {
  tunnel: Tunnel;
  showToast: (msg: string) => void;
  initialState?: ComposerState | null;
  onConsumeInit?: () => void;
}

const emptyKV = (): KVPair => ({ key: '', value: '', enabled: true });

const defaultComposer = (): ComposerState => ({
  method: 'GET', path: '/', params: [emptyKV()], headers: [emptyKV()],
  bodyType: 'none', body: '', name: '',
});

export function ComposerTab({ tunnel, showToast, initialState, onConsumeInit }: Props) {
  const [composer, setComposer] = useState<ComposerState>(() => initialState ?? defaultComposer());
  const [saved, setSaved] = useState<SavedRequest[]>([]);
  const [result, setResult] = useState<SendResult | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => { api.fetchSaved().then(setSaved).catch(() => {}); }, []);

  // Apply initialState when it changes (e.g. from Edit & Resend)
  useEffect(() => {
    if (initialState) {
      setComposer(initialState);
      setResult(null);
      onConsumeInit?.();
    }
  }, [initialState, onConsumeInit]);

  const update = (patch: Partial<ComposerState>) => setComposer(prev => ({ ...prev, ...patch }));

  const updateKV = (field: 'params' | 'headers', idx: number, key: keyof KVPair, val: string | boolean) => {
    setComposer(prev => {
      const list = [...prev[field]];
      list[idx] = { ...list[idx], [key]: val };
      return { ...prev, [field]: list };
    });
  };

  const removeKV = (field: 'params' | 'headers', idx: number) => {
    setComposer(prev => {
      const list = prev[field].filter((_, i) => i !== idx);
      return { ...prev, [field]: list.length ? list : [emptyKV()] };
    });
  };

  const addKV = (field: 'params' | 'headers') => {
    setComposer(prev => ({ ...prev, [field]: [...prev[field], emptyKV()] }));
  };

  const switchBodyType = (bodyType: string) => {
    setComposer(prev => {
      const next = { ...prev, bodyType };
      // Auto-add Content-Type header when switching to JSON
      if (bodyType === 'json' && !prev.headers.find(header => header.key.toLowerCase() === 'content-type')) {
        next.headers = [...prev.headers, { key: 'Content-Type', value: 'application/json', enabled: true }];
      }
      return next;
    });
  };

  const send = async () => {
    let path = composer.path;
    const activeParams = composer.params.filter(param => param.enabled && param.key);
    if (activeParams.length) {
      const queryString = activeParams.map(param => encodeURIComponent(param.key) + '=' + encodeURIComponent(param.value)).join('&');
      path += (path.includes('?') ? '&' : '?') + queryString;
    }
    const headers: Record<string, string[]> = {};
    composer.headers.filter(header => header.enabled && header.key).forEach(header => { headers[header.key] = [header.value]; });
    if (composer.bodyType === 'json' && !Object.keys(headers).find(key => key.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = ['application/json'];
    } else if (composer.bodyType === 'form' && !Object.keys(headers).find(key => key.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = ['application/x-www-form-urlencoded'];
    }
    setSending(true);
    try {
      const response = await api.send({ subdomain: tunnel.subdomain, method: composer.method, path, headers, body: composer.bodyType !== 'none' ? composer.body : '' });
      setResult(response);
    } catch (e: any) { showToast('Send error: ' + e.message); }
    finally { setSending(false); }
  };

  const saveReq = async () => {
    const name = composer.name || composer.method + ' ' + composer.path;
    try {
      await api.addSaved({ name, method: composer.method, path: composer.path, params: composer.params.filter(param => param.key), headers: composer.headers.filter(header => header.key), body_type: composer.bodyType, body: composer.body });
      showToast('Saved');
      setSaved(await api.fetchSaved());
    } catch (e: any) { showToast('Save error: ' + e.message); }
  };

  const loadSaved = (savedRequest: SavedRequest) => {
    setComposer({
      method: savedRequest.method || 'GET', path: savedRequest.path || '/',
      params: savedRequest.params?.length ? savedRequest.params : [emptyKV()],
      headers: savedRequest.headers?.length ? savedRequest.headers : [emptyKV()],
      bodyType: savedRequest.body_type || 'none', body: savedRequest.body || '', name: savedRequest.name || '',
    });
    setResult(null);
  };

  const deleteSaved = async (id: number) => {
    try { await api.deleteSaved(id); setSaved(await api.fetchSaved()); showToast('Deleted'); } catch (e: any) { showToast('Error: ' + e.message); }
  };

  const inputCls = "bg-input-bg border border-dim rounded-lg px-3 py-1.5 text-xs text-input-text outline-none focus:border-accent mono";
  const selectCls = "bg-input-bg border border-dim rounded-lg px-2 py-1.5 text-xs text-input-text outline-none focus:border-accent";

  return (
    <div>
      {saved.length > 0 && (
        <div className="mb-4">
          <div className="text-[.7rem] text-muted uppercase tracking-wider mb-2">Saved Requests</div>
          {saved.map(savedRequest => (
            <div key={savedRequest.id} className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer border border-border bg-surface mb-1.5 hover:border-dim" onClick={() => loadSaved(savedRequest)}>
              <span className={`px-1.5 py-0.5 rounded text-[.6rem] mono font-bold ${methodColor(savedRequest.method)}`}>{savedRequest.method}</span>
              <span className="flex-1 text-xs overflow-hidden text-ellipsis whitespace-nowrap">{savedRequest.name || savedRequest.path}</span>
              <button onClick={e => { e.stopPropagation(); deleteSaved(savedRequest.id); }} className="bg-transparent border-none text-dim cursor-pointer text-xs hover:text-danger">×</button>
            </div>
          ))}
        </div>
      )}

      <div className="bg-surface border border-border rounded-xl p-5">
        <div className="flex gap-2 mb-3 items-center">
          <select className={`${selectCls} w-[110px]`} value={composer.method} onChange={e => update({ method: e.target.value })}>
            {METHODS.map(method => <option key={method}>{method}</option>)}
          </select>
          <input className={`${inputCls} flex-1`} value={composer.path} placeholder="/api/endpoint" onChange={e => update({ path: e.target.value })} />
          <button onClick={send} disabled={sending} className="bg-accent text-white px-5 py-2 rounded-lg text-sm font-semibold border-none cursor-pointer whitespace-nowrap hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed">
            {sending ? 'Sending...' : 'Send'}
          </button>
        </div>

        <KVEditor label="Query Parameters" items={composer.params} field="params" updateKV={updateKV} removeKV={removeKV} addKV={addKV} />
        <KVEditor label="Headers" items={composer.headers} field="headers" updateKV={updateKV} removeKV={removeKV} addKV={addKV} />

        <div className="mt-3">
          <div className="text-[.7rem] text-muted uppercase tracking-wider mb-1">Body</div>
          <div className="flex gap-2 mb-2">
            {(['none', 'json', 'form', 'raw'] as const).map(bodyType => (
              <button key={bodyType} onClick={() => switchBodyType(bodyType)} className={`text-xs px-3 py-1.5 rounded-lg border-none cursor-pointer ${composer.bodyType === bodyType ? 'bg-accent/15 text-accent' : 'bg-input-bg text-input-text'}`}>
                {bodyType === 'none' ? 'None' : bodyType.toUpperCase()}
              </button>
            ))}
          </div>
          {comp.bodyType !== 'none' && (
            <textarea
              className="w-full min-h-24 bg-input-bg border border-dim rounded-lg px-3 py-2 mono text-sm text-input-text resize-y outline-none focus:border-accent"
              value={comp.body}
              onChange={e => update({ body: e.target.value })}
              placeholder={comp.bodyType === 'json' ? '{"key": "value"}' : comp.bodyType === 'form' ? 'key=value&other=data' : 'raw body content'}
            />
          )}
        </div>

        <div className="mt-3 flex gap-2 items-center">
          <input className={`${inputCls} flex-1`} placeholder="Request name (for saving)" value={comp.name} onChange={e => update({ name: e.target.value })} />
          <button onClick={saveReq} className="text-xs px-3 py-1.5 rounded-lg bg-input-bg text-input-text border-none cursor-pointer hover:bg-dim">Save</button>
          <button onClick={() => { setComp(defaultComp()); setResult(null); }} className="text-xs px-3 py-1.5 rounded-lg bg-input-bg text-input-text border-none cursor-pointer hover:bg-dim">Clear</button>
        </div>

        {result && (
          <div className="mt-4 border-t border-border pt-4">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-sm font-semibold text-muted">Response</span>
              <span className={`mono font-bold text-base ${statusColor(result.status)}`}>{result.status}</span>
              <span className="text-muted text-xs">{formatLatency(result.latency_ms)}</span>
              <span className="text-muted text-xs">{formatBytes((result.body || '').length)}</span>
            </div>
            {result.headers && (
              <div className="mb-3">
                <div className="text-[.7rem] text-muted uppercase tracking-wider mb-1">Response Headers</div>
                <table className="w-full text-sm border-collapse">
                  <tbody>
                    {Object.entries(result.headers).map(([k, v]) => (
                      <tr key={k}>
                        <td className="py-1 px-2 border-b border-td-border text-accent mono whitespace-nowrap w-[30%]">{k}</td>
                        <td className="py-1 px-2 border-b border-td-border text-input-text mono break-all">{Array.isArray(v) ? v.join(', ') : v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {result.body && (
              <div>
                <div className="text-[.7rem] text-muted uppercase tracking-wider mb-1">Response Body</div>
                <pre className="bg-pre-bg border border-border rounded-lg p-4 mono text-sm text-input-text whitespace-pre-wrap break-all overflow-x-auto max-h-[50vh]">
                  {(() => { try { return JSON.stringify(JSON.parse(result.body), null, 2); } catch { return result.body; } })()}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function KVEditor({ label, items, field, updateKV, removeKV, addKV }: {
  label: string; items: KVPair[]; field: 'params' | 'headers';
  updateKV: (f: 'params' | 'headers', i: number, k: keyof KVPair, v: string | boolean) => void;
  removeKV: (f: 'params' | 'headers', i: number) => void;
  addKV: (f: 'params' | 'headers') => void;
}) {
  return (
    <div className="mt-3">
      <div className="text-[.7rem] text-muted uppercase tracking-wider mb-1">{label}</div>
      {items.map((item, i) => (
        <div key={i} className="flex gap-1.5 items-center mb-1.5">
          <input type="checkbox" checked={item.enabled} onChange={e => updateKV(field, i, 'enabled', e.target.checked)} className="w-4 h-4 accent-accent cursor-pointer" />
          <input className={`flex-1 bg-input-bg border border-dim rounded-md px-2 py-1 text-xs text-input-text outline-none focus:border-accent mono ${!item.enabled ? 'opacity-50' : ''}`} placeholder="key" value={item.key} onChange={e => updateKV(field, i, 'key', e.target.value)} />
          <input className={`flex-1 bg-input-bg border border-dim rounded-md px-2 py-1 text-xs text-input-text outline-none focus:border-accent mono ${!item.enabled ? 'opacity-50' : ''}`} placeholder="value" value={item.value} onChange={e => updateKV(field, i, 'value', e.target.value)} />
          <button onClick={() => removeKV(field, i)} className="bg-transparent border-none text-dim cursor-pointer text-sm hover:text-danger">×</button>
        </div>
      ))}
      <button onClick={() => addKV(field)} className="w-full text-left bg-transparent border border-dashed border-dim rounded-md px-3 py-1 text-[.7rem] text-muted cursor-pointer hover:border-accent hover:text-accent">+ Add</button>
    </div>
  );
}
