import { useState, useEffect } from 'react';
import type { SendResult } from '../lib/types';
import { formatBytes, formatLatency, statusColor } from '../lib/utils';

interface Props {
  result: SendResult;
  onClose: () => void;
}

const tabs = ['Headers', 'Body'] as const;

export function ReplayModal({ result, onClose }: Props) {
  const [tab, setTab] = useState<(typeof tabs)[number]>('Headers');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  let content: React.ReactNode;
  if (tab === 'Headers') {
    if (!result.headers || Object.keys(result.headers).length === 0) {
      content = <div className="text-dim text-sm text-center py-8">No headers</div>;
    } else {
      content = (
        <table className="w-full text-sm border-collapse">
          <tbody>
            {Object.entries(result.headers).map(([name, values]) => (
              <tr key={name}>
                <td className="py-1 px-2 border-b border-td-border text-accent mono whitespace-nowrap w-[30%] align-top">{name}</td>
                <td className="py-1 px-2 border-b border-td-border text-input-text mono break-all">{Array.isArray(values) ? values.join(', ') : values}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
  } else {
    if (!result.body) {
      content = <div className="text-dim text-sm text-center py-8">No body</div>;
    } else {
      let display = result.body;
      try { display = JSON.stringify(JSON.parse(result.body), null, 2); } catch {}
      content = (
        <pre className="bg-pre-bg border border-border rounded-lg p-4 mono text-sm text-input-text whitespace-pre-wrap break-all overflow-x-auto max-h-[50vh]">
          {display}
        </pre>
      );
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center backdrop-blur-sm" onClick={onClose}>
      <div className="bg-bg border border-border rounded-xl w-[90vw] max-w-[900px] max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold">Replay Result</span>
            <span className={`mono text-sm ${statusColor(result.status)}`}>{result.status}</span>
            <span className="text-muted text-xs">{formatLatency(result.latency_ms)}</span>
            <span className="text-muted text-xs">{formatBytes((result.body || '').length)}</span>
          </div>
          <button onClick={onClose} className="bg-transparent border-none text-muted cursor-pointer text-xl px-1 leading-none hover:text-text" aria-label="Close">&times;</button>
        </div>
        <div className="flex border-b border-border px-5">
          {tabs.map(tabName => (
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
