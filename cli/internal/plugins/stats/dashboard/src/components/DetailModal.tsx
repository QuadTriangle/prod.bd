import { useState, useEffect } from 'react';
import type { RequestEntry } from '../lib/types';
import { formatBytes, formatLatency, statusColor, methodColor } from '../lib/utils';
import { JsonViewer } from './JsonViewer';

interface Props {
  request: RequestEntry;
  onClose: () => void;
  showToast: (msg: string) => void;
  onReplay: (id: number) => void;
  onCopyCurl: (id: number) => void;
  onEditResend: (request: RequestEntry) => void;
}

const modalTabs = ['Request Headers', 'Request Body', 'Response Headers', 'Response Body'] as const;

export function DetailModal({ request, onClose, showToast, onReplay, onCopyCurl, onEditResend }: Props) {
  const [tab, setTab] = useState<(typeof modalTabs)[number]>('Request Headers');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const contentTypeHeader = request.response_headers
    ? Object.entries(request.response_headers).find(([key]) => key.toLowerCase() === 'content-type')?.[1]
    : null;
  const contentTypeLabel = contentTypeHeader ? (Array.isArray(contentTypeHeader) ? contentTypeHeader[0] : contentTypeHeader) : '';

  let content: React.ReactNode;
  if (tab === 'Request Headers') content = <HeadersView headers={request.request_headers} />;
  else if (tab === 'Response Headers') content = <HeadersView headers={request.response_headers} />;
  else if (tab === 'Request Body') content = <BodyView body={request.request_body} showToast={showToast} />;
  else content = <BodyView body={request.response_body} showToast={showToast} />;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center backdrop-blur-sm" onClick={onClose}>
      <div className="bg-bg border border-border rounded-xl w-[90vw] max-w-[900px] max-h-[85vh] flex flex-col max-lg:w-[96vw] max-lg:max-h-[90vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3 flex-wrap">
            <span className={`px-1.5 py-0.5 rounded text-[.7rem] mono font-bold ${methodColor(request.method)}`}>{request.method}</span>
            <span className="mono text-sm text-input-text max-w-[350px] overflow-hidden text-ellipsis whitespace-nowrap" title={request.path}>{request.path}</span>
            <span className={`mono text-sm ${statusColor(request.status)}`}>{request.status}</span>
            <span className="text-muted text-xs">{formatLatency(request.latency_ms)}</span>
            <span className="text-muted text-xs">{formatBytes(request.bytes_in + request.bytes_out)}</span>
            {contentTypeLabel && <span className="text-dim text-[.65rem]">{contentTypeLabel.split(';')[0]}</span>}
          </div>
          <div className="flex items-center gap-1.5">
            <IconBtn title="Replay" onClick={() => onReplay(request.id)}>↻</IconBtn>
            <IconBtn title="Copy cURL" onClick={() => onCopyCurl(request.id)}>⎘</IconBtn>
            <IconBtn title="Edit & Resend" onClick={() => onEditResend(request)}>✎</IconBtn>
            <button onClick={onClose} className="bg-transparent border-none text-muted cursor-pointer text-xl px-1 leading-none hover:text-text" aria-label="Close">&times;</button>
          </div>
        </div>
        <div className="flex border-b border-border px-5">
          {modalTabs.map(tabName => (
            <button
              key={tabName}
              onClick={() => setTab(tabName)}
              className={`px-4 py-2 text-xs bg-transparent cursor-pointer border-b-2 border-t-0 border-l-0 border-r-0 ${
                tab === tabName ? 'text-accent border-accent' : 'text-muted border-transparent hover:text-text'
              }`}
            >
              {tabName}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-5">{content}</div>
      </div>
    </div>
  );
}

function HeadersView({ headers }: { headers?: Record<string, string[]> }) {
  if (!headers || Object.keys(headers).length === 0) {
    return <div className="text-dim text-sm text-center py-8">No headers</div>;
  }
  return (
    <table className="w-full text-sm border-collapse">
      <tbody>
        {Object.entries(headers).map(([name, values]) => (
          <tr key={name}>
            <td className="py-1 px-2 border-b border-td-border text-accent mono whitespace-nowrap w-[30%] align-top">{name}</td>
            <td className="py-1 px-2 border-b border-td-border text-input-text mono break-all">{Array.isArray(values) ? values.join(', ') : values}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BodyView({ body, showToast }: { body?: string; showToast: (msg: string) => void }) {
  if (!body) return <div className="text-dim text-sm text-center py-8">No body</div>;
  let parsed: unknown = null;
  try { parsed = JSON.parse(body); } catch {}
  const display = parsed !== null ? JSON.stringify(parsed, null, 2) : body;
  return (
    <div className="relative">
      <button
        className="absolute top-2 right-2 z-10 bg-transparent border border-border rounded-md w-7 h-7 cursor-pointer flex items-center justify-center text-xs text-muted hover:border-muted hover:text-text"
        title="Copy body"
        onClick={() => { navigator.clipboard.writeText(display); showToast('Copied'); }}
      >
        ⎘
      </button>
      {parsed !== null ? (
        <div className="bg-pre-bg border border-border rounded-lg p-4 overflow-auto max-h-[50vh]">
          <JsonViewer data={parsed} />
        </div>
      ) : (
        <pre className="bg-pre-bg border border-border rounded-lg p-4 mono text-sm text-input-text whitespace-pre-wrap break-all overflow-x-auto max-h-[50vh]">
          {body}
        </pre>
      )}
    </div>
  );
}

function IconBtn({ children, title, onClick }: { children: React.ReactNode; title: string; onClick: () => void }) {
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
