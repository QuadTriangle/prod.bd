import type { RequestEntry } from '../lib/types';
import { formatLatency, statusColor, methodColor } from '../lib/utils';

interface Props {
  requests: RequestEntry[];
}

export function TimelineTab({ requests }: Props) {
  if (requests.length === 0) {
    return <div className="text-dim text-center py-12">No requests to display</div>;
  }

  const sorted = [...requests].sort((a, b) => a.created_at - b.created_at);
  const minTime = sorted[0].created_at;
  const maxEnd = Math.max(...sorted.map(r => r.created_at + r.latency_ms / 1000));
  const span = Math.max(maxEnd - minTime, 0.001);

  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      <div className="p-4 border-b border-border flex items-center gap-3">
        <span className="text-sm font-medium text-input-text">Request Timeline</span>
        <span className="text-dim text-xs">{sorted.length} requests · {formatLatency(span * 1000)} total span</span>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[600px]">
          {/* Time axis */}
          <div className="flex justify-between px-4 py-1 text-[.6rem] text-dim border-b border-border">
            <span>0ms</span>
            <span>{formatLatency(span * 250)}</span>
            <span>{formatLatency(span * 500)}</span>
            <span>{formatLatency(span * 750)}</span>
            <span>{formatLatency(span * 1000)}</span>
          </div>
          {sorted.map(req => {
            const offset = ((req.created_at - minTime) / span) * 100;
            const width = Math.max(((req.latency_ms / 1000) / span) * 100, 0.5);
            return (
              <div key={req.id} className="flex items-center gap-2 px-4 py-1.5 border-b border-td-border hover:bg-hover-bg group">
                <div className="w-[140px] shrink-0 flex items-center gap-1.5 overflow-hidden">
                  <span className={`px-1 py-0.5 rounded text-[.6rem] mono font-bold ${methodColor(req.method)}`}>{req.method}</span>
                  <span className="text-[.65rem] mono text-muted truncate" title={req.path}>{req.path}</span>
                </div>
                <div className="flex-1 relative h-5">
                  <div className="absolute inset-0 flex items-center">
                    {/* Grid lines */}
                    {[25, 50, 75].map(pct => (
                      <div key={pct} className="absolute top-0 bottom-0 border-l border-border" style={{ left: `${pct}%` }} />
                    ))}
                  </div>
                  <div
                    className={`absolute h-3 rounded-sm top-1 ${req.status >= 400 ? 'bg-danger/70' : req.status >= 300 ? 'bg-warning/70' : 'bg-accent/70'}`}
                    style={{ left: `${offset}%`, width: `${width}%`, minWidth: '2px' }}
                    title={`${req.method} ${req.path} — ${req.status} — ${formatLatency(req.latency_ms)}`}
                  />
                </div>
                <div className="w-[80px] shrink-0 text-right flex items-center justify-end gap-2">
                  <span className={`text-[.65rem] mono ${statusColor(req.status)}`}>{req.status}</span>
                  <span className="text-[.65rem] mono text-muted">{formatLatency(req.latency_ms)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
