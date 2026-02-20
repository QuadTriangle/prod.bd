import { useState, useEffect } from 'react';
import type { Tunnel, SavedRequest, RunResult, Assertion } from '../lib/types';
import { api } from '../lib/api';
import { formatLatency, statusColor, methodColor } from '../lib/utils';

interface Props {
  tunnel: Tunnel;
  showToast: (msg: string) => void;
}

export function RunnerTab({ tunnel, showToast }: Props) {
  const [saved, setSaved] = useState<SavedRequest[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [results, setResults] = useState<RunResult[] | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => { api.fetchSaved().then(setSaved).catch(() => {}); }, []);

  const toggleAll = () => {
    if (selected.size === saved.length) setSelected(new Set());
    else setSelected(new Set(saved.map(s => s.id)));
  };

  const toggle = (id: number) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const run = async () => {
    setRunning(true);
    setResults(null);
    try {
      const ids = selected.size > 0 && selected.size < saved.length ? [...selected] : undefined;
      const res = await api.runCollection(tunnel.subdomain, ids);
      setResults(res);
    } catch (e: any) { showToast('Run failed: ' + e.message); }
    setRunning(false);
  };

  const totalPass = results?.reduce((n, r) => n + (r.assertions?.filter(a => a.passed).length ?? 0), 0) ?? 0;
  const totalFail = results?.reduce((n, r) => n + (r.assertions?.filter(a => !a.passed).length ?? 0), 0) ?? 0;
  const totalErr = results?.filter(r => r.error).length ?? 0;

  return (
    <div>
      <div className="bg-surface border border-border rounded-xl p-5 mb-4">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-sm font-medium text-input-text">Collection Runner</span>
          <div className="flex-1" />
          <button onClick={toggleAll} className="text-xs px-3 py-1.5 rounded-lg bg-input-bg text-input-text border-none cursor-pointer hover:bg-dim">
            {selected.size === saved.length ? 'Deselect All' : 'Select All'}
          </button>
          <button onClick={run} disabled={running || saved.length === 0} className="bg-accent text-white px-5 py-2 rounded-lg text-sm font-semibold border-none cursor-pointer hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed">
            {running ? 'Running...' : '▶ Run'}
          </button>
        </div>
        {saved.length === 0 ? (
          <div className="text-dim text-center py-6">No saved requests. Save some in the Composer tab first.</div>
        ) : (
          saved.map(sr => (
            <label key={sr.id} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-surface mb-1.5 cursor-pointer hover:border-dim">
              <input type="checkbox" checked={selected.has(sr.id)} onChange={() => toggle(sr.id)} className="w-4 h-4 accent-accent" />
              <span className={`px-1.5 py-0.5 rounded text-[.6rem] mono font-bold ${methodColor(sr.method)}`}>{sr.method}</span>
              <span className="flex-1 text-xs truncate">{sr.name || sr.path}</span>
              <span className="text-dim text-[.6rem]">{sr.assertions?.length ?? 0} assertions</span>
            </label>
          ))
        )}
      </div>

      {results && (
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border flex items-center gap-4">
            <span className="text-sm font-medium text-input-text">Results</span>
            <span className="text-accent text-xs">{totalPass} passed</span>
            {totalFail > 0 && <span className="text-danger text-xs">{totalFail} failed</span>}
            {totalErr > 0 && <span className="text-danger text-xs">{totalErr} errors</span>}
          </div>
          {results.map((r, i) => (
            <div key={i} className="px-4 py-3 border-b border-td-border">
              <div className="flex items-center gap-2 mb-1">
                <span className={`px-1.5 py-0.5 rounded text-[.6rem] mono font-bold ${methodColor(r.method)}`}>{r.method}</span>
                <span className="mono text-xs text-muted truncate">{r.name || r.path}</span>
                {r.error ? (
                  <span className="text-danger text-xs ml-auto">Error: {r.error}</span>
                ) : (
                  <>
                    <span className={`mono text-xs ml-auto ${statusColor(r.status)}`}>{r.status}</span>
                    <span className="text-muted text-xs">{formatLatency(r.latency_ms)}</span>
                  </>
                )}
              </div>
              {r.assertions && r.assertions.length > 0 && (
                <div className="ml-6 mt-1">
                  {r.assertions.map((a, j) => (
                    <div key={j} className="flex items-center gap-2 text-[.7rem] py-0.5">
                      <span className={a.passed ? 'text-accent' : 'text-danger'}>{a.passed ? '✓' : '✗'}</span>
                      <span className="text-muted">{a.assertion.target}{a.assertion.property ? `.${a.assertion.property}` : ''}</span>
                      <span className="text-dim">{a.assertion.operator}</span>
                      <span className="text-input-text mono">{a.assertion.value}</span>
                      {!a.passed && <span className="text-dim">got: {a.actual}</span>}
                      {a.error && <span className="text-danger">{a.error}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
