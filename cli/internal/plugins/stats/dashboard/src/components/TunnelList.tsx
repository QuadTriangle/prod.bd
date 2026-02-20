import type { Tunnel } from '../lib/types';
import { formatLatency } from '../lib/utils';

interface Props {
  tunnels: Tunnel[];
  selected: string | null;
  onSelect: (sub: string) => void;
}

export function TunnelList({ tunnels, selected, onSelect }: Props) {
  if (tunnels.length === 0) {
    return (
      <div className="bg-surface border border-border rounded-xl p-4 text-dim text-sm">
        No active tunnels
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {tunnels.map((tunnel) => (
        <button
          key={tunnel.subdomain}
          onClick={() => onSelect(tunnel.subdomain)}
          className={`w-full text-left p-3 rounded-xl border cursor-pointer transition-colors text-text ${
            selected === tunnel.subdomain
              ? 'bg-accent/8 border-accent/30'
              : 'bg-surface border-border hover:border-dim'
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm mono">{tunnel.subdomain}</span>
            <span className="text-[.7rem] bg-port-bg text-muted px-1.5 py-0.5 rounded">:{tunnel.port}</span>
          </div>
          <div className="flex gap-3 text-[.7rem] text-muted mt-1">
            <span>{tunnel.total_requests} reqs</span>
            {tunnel.error_count > 0 && <span className="text-danger">{tunnel.error_count} err</span>}
            <span>{formatLatency(tunnel.avg_latency)}</span>
          </div>
        </button>
      ))}
    </div>
  );
}
