import type { Summary } from '../lib/types';
import { formatBytes, formatLatency } from '../lib/utils';

export function SummaryCards({ summary }: { summary: Summary }) {
  const cards = [
    { label: 'Active Tunnels', value: summary.active_tunnels },
    { label: 'Total Requests', value: summary.total_requests.toLocaleString() },
    { label: 'Errors', value: summary.total_errors, cls: summary.total_errors > 0 ? 'text-danger' : '' },
    { label: 'Avg Latency', value: formatLatency(summary.avg_latency ?? 0) },
    { label: 'Traffic In', value: formatBytes(summary.total_bytes_in ?? 0) },
    { label: 'Traffic Out', value: formatBytes(summary.total_bytes_out ?? 0) },
  ];

  return (
    <div className="grid grid-cols-6 max-lg:grid-cols-3 gap-3 mb-6">
      {cards.map(card => (
        <div key={card.label} className="bg-surface border border-border rounded-xl p-4">
          <div className="text-[.7rem] text-muted uppercase tracking-wider mb-1">{card.label}</div>
          <div className={`text-xl font-bold mono ${card.cls ?? ''}`}>{card.value}</div>
        </div>
      ))}
    </div>
  );
}
