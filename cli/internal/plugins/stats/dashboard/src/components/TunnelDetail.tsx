import { useState, useCallback, useEffect } from 'react';
import type { Tunnel, RequestEntry, KVPair } from '../lib/types';
import { formatBytes, formatLatency, timeAgo } from '../lib/utils';
import { RequestsTab } from './RequestsTab';
import { ComposerTab } from './ComposerTab';
import { InterceptsTab } from './InterceptsTab';
import { TimelineTab } from './TimelineTab';
import { DiffTab } from './DiffTab';
import { WSInspectorTab } from './WSInspectorTab';
import { RunnerTab } from './RunnerTab';
import { UpstreamsTab } from './UpstreamsTab';
import { QRCode } from './QRCode';
import { api } from '../lib/api';
import type { ComposerState } from '../lib/types';

interface Props {
  tunnel: Tunnel;
  requests: RequestEntry[];
  onRefresh: () => void;
  showToast: (msg: string) => void;
}

const tabNames = ['Requests', 'Timeline', 'Composer', 'Runner', 'Intercepts', 'Upstreams', 'Diff', 'WebSocket'] as const;

const emptyKV = (): KVPair => ({ key: '', value: '', enabled: true });

export function TunnelDetail({ tunnel, requests, onRefresh, showToast }: Props) {
  const [tab, setTab] = useState<(typeof tabNames)[number]>('Requests');
  const [composerInit, setComposerInit] = useState<ComposerState | null>(null);
  const [diffPair, setDiffPair] = useState<[RequestEntry, RequestEntry] | null>(null);

  const total = tunnel.total_bytes_in + tunnel.total_bytes_out;
  const errRate = tunnel.total_requests > 0 ? ((tunnel.error_count / tunnel.total_requests) * 100).toFixed(1) + '%' : '0%';

  useEffect(() => {
    const handleKey = async (e: KeyboardEvent) => {
      // Ignore if typing in an input
      if (document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;

      if (e.key >= '1' && e.key <= String(tabNames.length)) {
        const idx = Number(e.key) - 1;
        setTab(tabNames[idx]);
      } else if (e.key.toLowerCase() === 'r') {
        onRefresh();
        showToast('Refreshed');
      } else if (e.key.toLowerCase() === 'c') {
        try {
          await api.clearLogs();
          onRefresh();
          showToast('Logs cleared');
        } catch (error: any) {
          showToast('Clear failed: ' + error.message);
        }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onRefresh, showToast]);

  const openComposerFrom = useCallback((request: RequestEntry) => {
    const [basePath, queryString] = (request.path || '/').split('?');
    let params: KVPair[] = [emptyKV()];
    if (queryString) {
      const pairs = queryString.split('&').map(param => {
        const [key, ...valueParts] = param.split('=');
        return { key: decodeURIComponent(key), value: decodeURIComponent(valueParts.join('=')), enabled: true };
      });
      if (pairs.length) params = pairs;
    }

    let headers: KVPair[] = [emptyKV()];
    if (request.request_headers) {
      const pairs = Object.entries(request.request_headers).map(([key, values]) => ({
        key, value: Array.isArray(values) ? values.join(', ') : values, enabled: true,
      }));
      if (pairs.length) headers = pairs;
    }

    const body = request.request_body || '';
    let bodyType = body ? 'raw' : 'none';
    if (body) {
      try { JSON.parse(body); bodyType = 'json'; } catch {}
    }

    setComposerInit({
      method: request.method,
      path: basePath,
      params,
      headers,
      bodyType,
      body,
      name: '',
      assertions: [],
    });
    setTab('Composer');
  }, []);

  const openDiff = useCallback((a: RequestEntry, b: RequestEntry) => {
    setDiffPair([a, b]);
    setTab('Diff');
  }, []);

  return (
    <div>
      <div className="flex gap-0 mb-4 border-b border-border">
        {tabNames.map((tabName, idx) => (
          <button
            key={tabName}
            onClick={() => setTab(tabName)}
            className={`px-4 py-2 text-sm border-b-2 bg-transparent cursor-pointer border-t-0 border-l-0 border-r-0 ${
              tab === tabName ? 'text-accent border-accent' : 'text-muted border-transparent hover:text-text'
            }`}
          >
            {tabName}
          </button>
        ))}
        <div className="flex-1" />
      </div>

      {/* Tunnel info card */}
      <div className="bg-surface border border-border rounded-xl p-5 mb-4">
        <div className="flex justify-between items-start mb-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <span className="text-xl font-bold mono">{tunnel.subdomain}</span>
              <span className="text-[.7rem] bg-port-bg text-muted px-1.5 py-0.5 rounded">:{tunnel.port}</span>
            </div>
            <a
              href={`https://${tunnel.subdomain}.prod.bd`}
              target="_blank"
              rel="noopener"
              className="text-accent no-underline mono text-sm hover:text-accent/80"
            >
              {tunnel.subdomain}.prod.bd ↗
            </a>
          </div>
          <QRCode url={`https://${tunnel.subdomain}.prod.bd`} />
        </div>
        <div className="grid grid-cols-6 max-lg:grid-cols-3 gap-3">
          {([
            ['Requests', tunnel.total_requests.toLocaleString(), ''],
            ['Errors', String(tunnel.error_count), tunnel.error_count > 0 ? 'text-danger' : ''],
            ['Error Rate', errRate, ''],
            ['Avg Latency', formatLatency(tunnel.avg_latency), ''],
            ['Traffic', formatBytes(total), ''],
            ['Running', timeAgo(tunnel.connected_at), ''],
          ] as const).map(([label, value, cls]) => (
            <div key={label}>
              <div className="text-[.7rem] text-muted">{label}</div>
              <div className={`text-sm font-bold mono ${cls}`}>{value}</div>
            </div>
          ))}
        </div>
      </div>

      {tab === 'Requests' && (
        <RequestsTab
          requests={requests}
          onRefresh={onRefresh}
          showToast={showToast}
          tunnel={tunnel}
          onOpenComposerFrom={openComposerFrom}
          onOpenDiff={openDiff}
        />
      )}
      {tab === 'Timeline' && (
        <TimelineTab requests={requests} />
      )}
      {tab === 'Composer' && (
        <ComposerTab
          tunnel={tunnel}
          showToast={showToast}
          initialState={composerInit}
          onConsumeInit={() => setComposerInit(null)}
        />
      )}
      {tab === 'Intercepts' && (
        <InterceptsTab showToast={showToast} />
      )}
      {tab === 'Upstreams' && (
        <UpstreamsTab subdomain={tunnel.subdomain} showToast={showToast} />
      )}
      {tab === 'Diff' && (
        <DiffTab requests={requests} initialPair={diffPair} onConsume={() => setDiffPair(null)} />
      )}
      {tab === 'Runner' && (
        <RunnerTab tunnel={tunnel} showToast={showToast} />
      )}
      {tab === 'WebSocket' && (
        <WSInspectorTab subdomain={tunnel.subdomain} showToast={showToast} />
      )}
    </div>
  );
}
