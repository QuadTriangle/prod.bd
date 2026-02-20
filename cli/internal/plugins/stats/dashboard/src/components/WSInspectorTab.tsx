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
  const [filterText, setFilterText] = useState('');
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [selectedMsg, setSelectedMsg] = useState<WSMessage | null>(null);
  const [sendPayload, setSendPayload] = useState('');

  const refresh = useCallback(async () => {
    try { setMessages(await api.fetchWSMessages(subdomain)); } catch {}
  }, [subdomain]);

  useEffect(() => { refresh(); }, [refresh]);

  // Live updates via SSE
  useEffect(() => {
    return api.subscribeSSE({ onWSFrame: refresh });
  }, [refresh]);

  const sessions = Array.from(new Set(messages.map(m => m.session_id)));

  const filtered = messages.filter(m => {
    if (selectedSession && m.session_id !== selectedSession) return false;
    if (filter !== 'all' && m.direction !== filter) return false;
    if (filterText && !m.payload.toLowerCase().includes(filterText.toLowerCase())) return false;
    return true;
  });

  const clear = async () => {
    try { await api.clearWSMessages(); setMessages([]); showToast('WS messages cleared'); } catch {}
  };

  const handleSend = async () => {
    if (!selectedSession || !sendPayload.trim()) return;
    try {
      await api.sendWSSession(selectedSession, false, sendPayload); // wait, send is API payload? no, the form uses true parameter for string
      setSendPayload('');
      showToast('Sent');
    } catch (e: any) { showToast('Send failed: ' + e.message); }
  };

  return (
    <div className="flex gap-4 max-lg:flex-col h-[70vh]">
      <div className="bg-surface border border-border rounded-xl flex flex-col w-52 shrink-0 overflow-hidden">
        <div className="p-4 border-b border-border bg-table-header">
          <span className="text-sm font-medium text-text">Sessions</span>
        </div>
        <div className="flex-1 overflow-y-auto">
          <div
            onClick={() => { setSelectedSession(null); setSelectedMsg(null); }}
            className={`px-4 py-2 cursor-pointer text-xs ${!selectedSession ? 'bg-accent/15 text-accent font-medium' : 'text-text hover:bg-hover-bg'}`}
          >
            All Sessions
          </div>
          {sessions.map(s => (
            <div key={s}
              onClick={() => { setSelectedSession(s); setSelectedMsg(null); }}
              className={`px-4 py-2 cursor-pointer text-xs border-t border-border ${selectedSession === s ? 'bg-accent/15 text-accent font-medium' : 'text-muted hover:bg-hover-bg'}`}
            >
              id: {s.slice(0, 8)}
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col bg-surface border border-border rounded-xl overflow-hidden min-w-0">
        <div className="p-4 border-b border-border flex items-center gap-2 flex-wrap bg-table-header">
          <span className="text-sm font-medium text-text min-w-max">WebSocket Frames</span>
          <span className="text-muted text-xs mx-2">({filtered.length})</span>

          <input
            type="text"
            placeholder="Filter text..."
            className="flex-1 min-w-[120px] bg-input-bg border border-dim rounded px-2 py-1 text-xs text-input-text outline-none focus:border-accent"
            value={filterText}
            onChange={e => setFilterText(e.target.value)}
          />

          <div className="flex gap-1 shrink-0">
            {(['all', 'in', 'out'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)} className={`text-xs px-2.5 py-1 rounded border-none cursor-pointer ${filter === f ? 'bg-accent/15 text-accent' : 'bg-input-bg text-input-text'}`}>
                {f === 'all' ? 'All' : f === 'in' ? '↓ In' : '↑ Out'}
              </button>
            ))}
            <button onClick={clear} className="text-xs px-2.5 py-1 rounded bg-input-bg text-input-text border-none cursor-pointer ml-1 hover:bg-dim">🗑 Clear</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          {filtered.length === 0 ? (
            <div className="text-dim text-center py-12 text-sm">No messages</div>
          ) : filtered.map(msg => (
            <div
              key={msg.id}
              onClick={() => setSelectedMsg(msg)}
              className={`flex items-center gap-2 px-4 py-2 border-b border-td-border cursor-pointer hover:bg-hover-bg text-xs ${selectedMsg?.id === msg.id ? 'bg-accent/5' : ''}`}
            >
              <span className={`w-4 text-center font-bold ${msg.direction === 'in' ? 'text-info' : 'text-warning'}`}>
                {msg.direction === 'in' ? '↓' : '↑'}
              </span>
              {!selectedSession && (
                <span className="text-muted shrink-0 w-12 truncate">{msg.session_id.slice(0, 6)}</span>
              )}
              <span className="mono text-muted truncate flex-1" title={msg.payload}>
                {msg.is_text ? msg.payload.slice(0, 120) : `[binary ${formatBytes(msg.size)}]`}
              </span>
              <span className="text-dim shrink-0">{formatBytes(msg.size)}</span>
              <span className="text-dim shrink-0">{timeAgo(msg.timestamp)}</span>
            </div>
          ))}
        </div>

        {selectedSession && (
          <div className="p-3 border-t border-border flex gap-2 items-center bg-table-header shrink-0">
            <input
              type="text"
              className="flex-1 bg-input-bg border border-dim rounded-lg px-3 py-1.5 text-xs text-input-text outline-none focus:border-accent"
              placeholder="Send a WS message..."
              value={sendPayload}
              onChange={e => setSendPayload(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSend(); }}
            />
            <button onClick={handleSend} className="bg-accent text-white border-none rounded-lg px-4 py-1.5 text-xs cursor-pointer hover:opacity-90 font-medium">Send</button>
          </div>
        )}
      </div>

      {selectedMsg && (
        <div className="flex flex-col w-[350px] max-lg:w-full bg-surface border border-border rounded-xl overflow-hidden shrink-0">
          <div className="p-4 border-b border-border flex items-center justify-between bg-table-header text-sm">
            <div className="flex items-center gap-2">
              <span className={`font-bold ${selectedMsg.direction === 'in' ? 'text-info' : 'text-warning'}`}>
                {selectedMsg.direction === 'in' ? '↓ Inbound' : '↑ Outbound'}
              </span>
              <span className="text-dim text-xs">Session: {selectedMsg.session_id.slice(0, 8)}</span>
            </div>
            <button onClick={() => setSelectedMsg(null)} className="bg-transparent border-none text-muted cursor-pointer text-lg hover:text-text leading-none">&times;</button>
          </div>
          <div className="p-4 overflow-auto flex-1 min-h-0 bg-code-bg">
            {selectedMsg.is_text ? (
              (() => {
                try {
                  const parsed = JSON.parse(selectedMsg.payload);
                  return <JsonViewer data={parsed} />;
                } catch {
                  return <pre className="mono text-xs text-text whitespace-pre-wrap break-all leading-relaxed m-0">{selectedMsg.payload}</pre>;
                }
              })()
            ) : (
              <div className="text-dim text-sm italic">Binary frame · {formatBytes(selectedMsg.size)}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
