import { useState, useEffect, useCallback, useRef } from 'react';
import type { Tunnel, RequestEntry, Summary } from '../lib/types';
import { api } from '../lib/api';
import { Header } from './Header';
import { SummaryCards } from './SummaryCards';
import { TunnelList } from './TunnelList';
import { TunnelDetail } from './TunnelDetail';

export default function Dashboard() {
  const [tunnels, setTunnels] = useState<Tunnel[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [requests, setRequests] = useState<RequestEntry[]>([]);
  const [live, setLive] = useState(true);
  const [toast, setToast] = useState('');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  }, []);

  const fetchAll = useCallback(async () => {
    try {
      const [tunnelList, summaryData] = await Promise.all([api.fetchTunnels(), api.fetchSummary()]);
      setTunnels(tunnelList);
      setSummary(summaryData);
      setConnected(true);
    } catch {
      setConnected(false);
    }
    setLoading(false);
  }, []);

  const fetchReqs = useCallback(async (subdomain: string) => {
    try {
      setRequests(await api.fetchRequests(subdomain));
    } catch {
      setRequests([]);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    if (selected) fetchReqs(selected);
  }, [selected, fetchReqs]);

  useEffect(() => {
    if (live) {
      intervalRef.current = setInterval(() => {
        fetchAll();
        if (selected) fetchReqs(selected);
      }, 2000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [live, selected, fetchAll, fetchReqs]);

  const refresh = async () => {
    await fetchAll();
    if (selected) await fetchReqs(selected);
  };

  const toggleLive = () => setLive(prev => !prev);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="text-muted">Connecting to CLI stats server...</span>
      </div>
    );
  }

  if (!connected) {
    return (
      <>
        <Header connected={false} live={false} onToggleLive={toggleLive} onRefresh={refresh} />
        <div className="max-w-[1600px] mx-auto px-6 text-center py-16">
          <div className="text-muted text-lg mb-2">CLI not running</div>
          <div className="text-dim text-sm mb-4">Start a tunnel to see live stats:</div>
          <code className="bg-input-bg px-4 py-2 rounded-lg text-accent text-sm mono">prod 3000</code>
        </div>
      </>
    );
  }

  return (
    <>
      <Header connected={connected} live={live} onToggleLive={toggleLive} onRefresh={refresh} />
      <div className="max-w-[1600px] mx-auto p-6">
        {summary && <SummaryCards summary={summary} />}
        <div className="flex gap-6 max-lg:flex-col">
          <div className="w-70 shrink-0 max-lg:w-full">
            <div className="text-[.7rem] text-muted uppercase tracking-wider mb-2 px-1">Tunnels</div>
            <TunnelList tunnels={tunnels} selected={selected} onSelect={setSelected} />
          </div>
          <div className="flex-1 min-w-0">
            {selected ? (
              <TunnelDetail
                tunnel={tunnels.find(tunnel => tunnel.subdomain === selected)!}
                requests={requests}
                onRefresh={() => fetchReqs(selected)}
                showToast={showToast}
              />
            ) : (
              <div className="flex items-center justify-center h-64 bg-surface rounded-xl border border-border">
                <div className="text-center">
                  <div className="text-dim text-lg mb-1">Select a tunnel</div>
                  <div className="text-dim text-sm">Pick a tunnel from the sidebar to view its stats</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      {toast && (
        <div className="fixed bottom-6 right-6 bg-surface border border-border rounded-lg px-4 py-2 text-sm shadow-lg z-50">
          {toast}
        </div>
      )}
    </>
  );
}
