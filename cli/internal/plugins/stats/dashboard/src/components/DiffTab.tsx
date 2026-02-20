import { useState, useEffect } from 'react';
import type { RequestEntry } from '../lib/types';
import { statusColor, methodColor, formatLatency } from '../lib/utils';

interface Props {
  requests: RequestEntry[];
  initialPair?: [RequestEntry, RequestEntry] | null;
  onConsume?: () => void;
}

function diffLines(a: string, b: string): { type: 'same' | 'add' | 'del'; text: string }[] {
  const linesA = a.split('\n');
  const linesB = b.split('\n');
  // Simple LCS-based diff
  const m = linesA.length, n = linesB.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] = linesA[i] === linesB[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);

  const result: { type: 'same' | 'add' | 'del'; text: string }[] = [];
  let i = 0, j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && linesA[i] === linesB[j]) {
      result.push({ type: 'same', text: linesA[i] });
      i++; j++;
    } else if (j < n && (i >= m || dp[i][j + 1] >= dp[i + 1][j])) {
      result.push({ type: 'add', text: linesB[j] });
      j++;
    } else {
      result.push({ type: 'del', text: linesA[i] });
      i++;
    }
  }
  return result;
}

function formatBody(body?: string): string {
  if (!body) return '';
  try { return JSON.stringify(JSON.parse(body), null, 2); } catch { return body; }
}

function formatHeaders(headers?: Record<string, string[]>): string {
  if (!headers) return '';
  return Object.entries(headers).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join('\n');
}

export function DiffTab({ requests, initialPair, onConsume }: Props) {
  const [leftId, setLeftId] = useState<number | ''>('');
  const [rightId, setRightId] = useState<number | ''>('');
  const [diffTarget, setDiffTarget] = useState<'response_body' | 'request_body' | 'response_headers' | 'request_headers'>('response_body');

  useEffect(() => {
    if (initialPair) {
      setLeftId(initialPair[0].id);
      setRightId(initialPair[1].id);
      onConsume?.();
    }
  }, [initialPair, onConsume]);

  const left = requests.find(r => r.id === leftId);
  const right = requests.find(r => r.id === rightId);

  const getContent = (req: RequestEntry | undefined): string => {
    if (!req) return '';
    if (diffTarget === 'response_body') return formatBody(req.response_body);
    if (diffTarget === 'request_body') return formatBody(req.request_body);
    if (diffTarget === 'response_headers') return formatHeaders(req.response_headers);
    return formatHeaders(req.request_headers);
  };

  const lines = left && right ? diffLines(getContent(left), getContent(right)) : null;

  const selectCls = "bg-input-bg border border-dim rounded-lg px-3 py-1.5 text-xs text-input-text outline-none focus:border-accent";

  const ReqLabel = ({ req }: { req?: RequestEntry }) => {
    if (!req) return <span className="text-dim">—</span>;
    return (
      <span className="flex items-center gap-1.5">
        <span className={`px-1 py-0.5 rounded text-[.6rem] mono font-bold ${methodColor(req.method)}`}>{req.method}</span>
        <span className="mono text-xs text-muted truncate max-w-[200px]">{req.path}</span>
        <span className={`mono text-xs ${statusColor(req.status)}`}>{req.status}</span>
        <span className="text-dim text-[.6rem]">{formatLatency(req.latency_ms)}</span>
      </span>
    );
  };

  return (
    <div>
      <div className="bg-surface border border-border rounded-xl p-4 mb-4">
        <div className="flex gap-3 items-end flex-wrap">
          <div>
            <div className="text-[.7rem] text-muted uppercase tracking-wider mb-1">Left (A)</div>
            <select className={selectCls} value={leftId} onChange={e => setLeftId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">Select request...</option>
              {requests.map(r => <option key={r.id} value={r.id}>#{r.id} {r.method} {r.path} → {r.status}</option>)}
            </select>
          </div>
          <div>
            <div className="text-[.7rem] text-muted uppercase tracking-wider mb-1">Right (B)</div>
            <select className={selectCls} value={rightId} onChange={e => setRightId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">Select request...</option>
              {requests.map(r => <option key={r.id} value={r.id}>#{r.id} {r.method} {r.path} → {r.status}</option>)}
            </select>
          </div>
          <div>
            <div className="text-[.7rem] text-muted uppercase tracking-wider mb-1">Compare</div>
            <select className={selectCls} value={diffTarget} onChange={e => setDiffTarget(e.target.value as any)}>
              <option value="response_body">Response Body</option>
              <option value="request_body">Request Body</option>
              <option value="response_headers">Response Headers</option>
              <option value="request_headers">Request Headers</option>
            </select>
          </div>
        </div>
        {(left || right) && (
          <div className="flex gap-6 mt-3 text-xs">
            <div><span className="text-dim mr-1">A:</span> <ReqLabel req={left} /></div>
            <div><span className="text-dim mr-1">B:</span> <ReqLabel req={right} /></div>
          </div>
        )}
      </div>

      {lines ? (
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <pre className="p-4 mono text-sm overflow-x-auto max-h-[60vh]">
            {lines.map((line, i) => (
              <div
                key={i}
                className={
                  line.type === 'add' ? 'bg-accent/10 text-accent' :
                  line.type === 'del' ? 'bg-danger/10 text-danger' :
                  'text-input-text'
                }
              >
                <span className="inline-block w-5 text-right mr-2 text-dim select-none">
                  {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}
                </span>
                {line.text}
              </div>
            ))}
            {lines.length === 0 && <div className="text-dim">No differences</div>}
          </pre>
        </div>
      ) : (
        <div className="text-dim text-center py-12">Select two requests above to compare</div>
      )}
    </div>
  );
}
