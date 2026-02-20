import { useState } from 'react';
import type { Tunnel, RequestEntry } from '../lib/types';
import { formatBytes, formatLatency, timeAgo, statusColor, methodColor, contentTypeShort, METHODS } from '../lib/utils';
import { api } from '../lib/api';
import { DetailModal } from './DetailModal';
import { ReplayModal } from './ReplayModal';
import type { SendResult } from '../lib/types';

interface Props {
  requests: RequestEntry[];
  tunnel: Tunnel;
  onRefresh: () => void;
  showToast: (msg: string) => void;
  onOpenComposerFrom?: (r: RequestEntry) => void;
}

export function RequestsTab({ requests, tunnel, onRefresh, showToast, onOpenComposerFrom }: Props) {
  const [filterMethod, setFilterMethod] = useState('ALL');
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [searchPath, setSearchPath] = useState('');
  const [modalReq, setModalReq] = useState<RequestEntry | null>(null);
  const [replayResult, setReplayResult] = useState<SendResult | null>(null);

  const filtered = requests.filter(request => {
    if (filterMethod !== 'ALL' && request.method !== filterMethod) return false;
    if (filterStatus === '2xx' && (request.status < 200 || request.status >= 300)) return false;
    if (filterStatus === '3xx' && (request.status < 300 || request.status >= 400)) return false;
    if (filterStatus === '4xx' && (request.status < 400 || request.status >= 500)) return false;
    if (filterStatus === '5xx' && request.status < 500) return false;
    if (searchPath && !request.path.toLowerCase().includes(searchPath.toLowerCase())) return false;
    return true;
  });

  const clearLogs = async () => {
    try {
      await api.clearLogs();
      onRefresh();
      showToast('Logs cleared');
    } catch (error: any) {
      showToast('Failed: ' + error.message);
    }
  };

  const replayReq = async (id: number) => {
    try {
      const data = await api.replay(id);
      onRefresh();
      setReplayResult(data);
    } catch (error: any) {
      showToast('Replay failed: ' + error.message);
    }
  };

  const copyCurl = async (id: number) => {
    try {
      const curl = await api.getCurl(id);
      await navigator.clipboard.writeText(curl);
      showToast('cURL copied');
    } catch (error: any) {
      showToast('Failed: ' + error.message);
    }
  };

  const editAndResend = (request: RequestEntry) => {
    setModalReq(null);
    onOpenComposerFrom?.(request);
  };

  const getContentType = (request: RequestEntry) => {
    if (!request.response_headers) return '';
    const entry = Object.entries(request.response_headers).find(([key]) => key.toLowerCase() === 'content-type');
    if (!entry) return '';
    const value = entry[1];
    return contentTypeShort(Array.isArray(value) ? value[0] : value);
  };

  const selectCls = "bg-input-bg border border-dim rounded-lg px-3 py-1.5 text-xs text-input-text outline-none focus:border-accent";
  const inputCls = "bg-input-bg border border-dim rounded-lg px-3 py-1.5 text-xs text-input-text outline-none focus:border-accent";

  return (
    <>
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <div className="p-4 border-b border-border flex items-center gap-3 flex-wrap">
          <span className="text-sm font-medium text-input-text">Request Log</span>
          <div className="flex-1" />
          <input
            className={inputCls}
            placeholder="Filter path..."
            value={searchPath}
            onChange={e => setSearchPath(e.target.value)}
          />
          <select className={selectCls} value={filterMethod} onChange={e => setFilterMethod(e.target.value)}>
            <option value="ALL">All Methods</option>
            {METHODS.map(method => <option key={method} value={method}>{method}</option>)}
          </select>
          <select className={selectCls} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="ALL">All Status</option>
            {['2xx', '3xx', '4xx', '5xx'].map(statusRange => <option key={statusRange} value={statusRange}>{statusRange}</option>)}
          </select>
          <button onClick={clearLogs} className="text-xs px-3 py-1.5 rounded-lg bg-input-bg text-input-text border-none cursor-pointer hover:bg-dim">
            🗑 Clear
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr>
                {['Method', 'Path', 'Status', 'Type', 'Latency', 'Size', 'Time', ''].map(heading => (
                  <th key={heading} className="text-left px-4 py-2 text-[.7rem] text-muted uppercase tracking-wider border-b border-border font-medium">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={8} className="text-center text-dim py-8">No requests yet</td></tr>
              ) : (
                filtered.map(request => (
                  <tr key={request.id} className="cursor-pointer hover:bg-hover-bg" onClick={() => setModalReq(request)}>
                    <td className="px-4 py-2 border-b border-td-border">
                      <span className={`px-1.5 py-0.5 rounded text-[.7rem] mono font-bold ${methodColor(request.method)}`}>{request.method}</span>
                    </td>
                    <td className="px-4 py-2 border-b border-td-border mono text-muted text-xs max-w-80 overflow-hidden text-ellipsis whitespace-nowrap" title={request.path}>{request.path}</td>
                    <td className={`px-4 py-2 border-b border-td-border mono ${statusColor(request.status)}`}>{request.status}</td>
                    <td className="px-4 py-2 border-b border-td-border text-dim text-[.7rem]">{getContentType(request)}</td>
                    <td className="px-4 py-2 border-b border-td-border text-muted">{formatLatency(request.latency_ms)}</td>
                    <td className="px-4 py-2 border-b border-td-border text-muted text-xs">{formatBytes(request.bytes_in + request.bytes_out)}</td>
                    <td className="px-4 py-2 border-b border-td-border text-muted text-xs">{timeAgo(request.created_at)}</td>
                    <td className="px-4 py-2 border-b border-td-border whitespace-nowrap">
                      <div className="flex gap-0.5">
                        <IconBtn title="Replay" onClick={e => { e.stopPropagation(); replayReq(request.id); }}>↻</IconBtn>
                        <IconBtn title="Copy cURL" onClick={e => { e.stopPropagation(); copyCurl(request.id); }}>⎘</IconBtn>
                        <IconBtn title="Edit & Resend" onClick={e => { e.stopPropagation(); editAndResend(request); }}>✎</IconBtn>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      {modalReq && (
        <DetailModal
          request={modalReq}
          onClose={() => setModalReq(null)}
          showToast={showToast}
          onReplay={replayReq}
          onCopyCurl={copyCurl}
          onEditResend={editAndResend}
        />
      )}
      {replayResult && (
        <ReplayModal result={replayResult} onClose={() => setReplayResult(null)} />
      )}
    </>
  );
}

function IconBtn({ children, title, onClick }: { children: React.ReactNode; title: string; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="bg-transparent border border-border rounded-md w-7 h-7 cursor-pointer flex items-center justify-center text-xs text-muted hover:border-muted hover:text-text"
    >
      {children}
    </button>
  );
}
