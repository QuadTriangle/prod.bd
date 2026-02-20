import { useState, useEffect, useCallback } from 'react';
import type { WSMessage } from '../lib/types';
import { api } from '../lib/api';
import { formatBytes, timeAgo } from '../lib/utils';
import { JsonViewer } from './JsonViewer';

interface Props {
  subdomain: string;
  showToast: (msg: string) => void;
}

export function WSInspectorTab({ subdomain, showToast }: Props) {
  const [messages, setMessages] = useState<WSMessage[]>([]);
  const [filter, setFilter] = useState<'all' | 'in' | 'out'>('all');
  const [selected, setSelected] = useState<WSMessage | null>(null);

  const refresh = useCallback(async () => {
    try { setMessages(await api.fetchWSMessages(subdomain)); } catch {}
  }, [subdomain]);

  useEffect(() => { refresh(); }, [refresh]);

  // Live updates via SSE
  useEffect(() => {
    return api.subscribeSSE({ onWSFrame: refresh });
  }, [refresh]);

  const filtered = filter === 'all' ? messages : messages.filter(m => m.direction === filter);

  const clear = async () => {
    try { await api.clearWSMessages(); setMessages([]); showToast('WS messages cleared'); } catch {}
  };

  return (
    <div className="flex gap-4 max-lg:flex-col">
      <div className="flex-1 bg-surface border border-border rounded-xl overflow-hidden">
        <div className="p-4 border-b border-border flex items-center gap-3">
          <span className="text-sm font-medium text-input-text">WebSocket Frames</span>
          <span className="text-dim text-xs">{messages.length} messages</span>
          <div className="flex-1" />
          {(['all', 'in', 'out'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} className={`text-xs px-3 py-1 rounded-lg border-none cursor-pointer ${filter === f ? 'bg-accent/15 text-accent' : 'bg-input-bg text-input-text'}`}>
              {f === 'all' ? 'All' : f === 'in' ? '↓ In' : '↑ Out'}
            </button>
          ))}
          <button onClick={clear} className="text-xs px-3 py-1.5 rounded-lg bg-input-bg text-input-text border-none cursor-pointer hover:bg-dim">🗑</button>
        </div>
        <div className="overflow-y-auto max-h-[60vh]">
          {filtered.length === 0 ? (
            <div className="text-dim text-center py-12">No WebSocket messages yet</div>
          ) : filtered.map(msg => (
            <div
              key={msg.id}
              onClick={() => setSelected(msg)}
              className={`flex items-center gap-2 px-4 py-2 border-b border-td-border cursor-pointer hover:bg-hover-bg text-xs ${selected?.id === msg.id ? 'bg-accent/5' : ''}`}
            >
              <span className={`w-5 text-center font-bold ${msg.direction === 'in' ? 'text-info' : 'text-warning'}`}>
                {msg.direction === 'in' ? '↓' : '↑'}
              </span>
              <span className="mono text-muted truncate flex-1" title={msg.payload}>
                {msg.is_text ? msg.payload.slice(0, 120) : `[binary ${formatBytes(msg.size)}]`}
              </span>
              <span className="text-dim shrink-0">{formatBytes(msg.size)}</span>
              <span className="text-dim shrink-0">{timeAgo(msg.timestamp)}</span>
            </div>
          ))}
        </div>
      </div>

      {selected && (
        <div className="w-[400px] max-lg:w-full bg-surface border border-border rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`font-bold ${selected.direction === 'in' ? 'text-info' : 'text-warning'}`}>
                {selected.direction === 'in' ? '↓ Inbound' : '↑ Outbound'}
              </span>
              <span className="text-dim text-xs">Session: {selected.session_id.slice(0, 8)}</span>
            </div>
            <button onClick={() => setSelected(null)} className="bg-transparent border-none text-muted cursor-pointer text-lg hover:text-text">&times;</button>
          </div>
          <div className="p-4 overflow-auto max-h-[50vh]">
            {selected.is_text ? (
              (() => {
                try {
                  const parsed = JSON.parse(selected.payload);
                  return <JsonViewer data={parsed} />;
                } catch {
                  return <pre className="mono text-sm text-input-text whitespace-pre-wrap break-all">{selected.payload}</pre>;
                }
              })()
            ) : (
              <div className="text-dim text-sm">Binary frame · {formatBytes(selected.size)}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
