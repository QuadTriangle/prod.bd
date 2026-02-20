import { useEffect, useState } from 'react';

interface Props {
  connected: boolean;
  live: boolean;
  onToggleLive: () => void;
  onRefresh: () => void;
}

export function Header({ connected, live, onToggleLive, onRefresh }: Props) {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('theme');
    if (saved === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
      setDark(true);
    }
  }, []);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    if (next) {
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('theme', 'light');
    }
  };

  return (
    <header className="border-b border-border bg-header-bg backdrop-blur-[8px] sticky top-0 z-40">
      <div className="max-w-[1600px] mx-auto px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <a target="_blank" href="https://prod.bd" className="text-accent font-bold text-lg no-underline">
            prod.bd
          </a>
          <span className="text-dim">/</span>
          <span className="text-muted text-sm">Dashboard</span>
        </div>
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded ${connected ? 'text-accent' : 'text-danger'}`}>
            <div className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-accent' : 'bg-danger'}`} />
            <span>{connected ? 'Connected' : 'CLI offline'}</span>
          </div>
          <button
            onClick={onToggleLive}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border-none cursor-pointer ${
              live ? 'bg-accent/15 text-accent' : 'bg-dim text-muted'
            }`}
          >
            <div className={`w-1.5 h-1.5 rounded-full ${live ? 'bg-accent animate-pulse' : 'bg-muted'}`} />
            {live ? 'Live' : 'Paused'}
          </button>
          <button
            onClick={onRefresh}
            className="text-xs px-3 py-1.5 rounded-lg bg-input-bg text-input-text border-none cursor-pointer hover:bg-dim"
          >
            ↻ Refresh
          </button>
          <button
            onClick={toggleTheme}
            className="w-[30px] h-[30px] border border-border rounded-lg bg-transparent cursor-pointer flex items-center justify-center text-sm hover:border-muted"
            aria-label="Toggle theme"
          >
            {dark ? '🌙' : '☀️'}
          </button>
        </div>
      </div>
    </header>
  );
}
