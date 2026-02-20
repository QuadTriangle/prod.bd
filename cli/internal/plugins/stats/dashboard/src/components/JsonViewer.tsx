import { useState } from 'react';

interface Props {
  data: unknown;
  initialExpanded?: number; // depth to auto-expand, default 2
}

export function JsonViewer({ data, initialExpanded = 2 }: Props) {
  return (
    <div className="mono text-sm">
      <JsonNode value={data} depth={0} autoExpand={initialExpanded} />
    </div>
  );
}

function JsonNode({ value, depth, autoExpand, keyName }: {
  value: unknown; depth: number; autoExpand: number; keyName?: string;
}) {
  const [expanded, setExpanded] = useState(depth < autoExpand);

  const prefix = keyName !== undefined ? (
    <span className="text-accent">{JSON.stringify(keyName)}<span className="text-dim">: </span></span>
  ) : null;

  if (value === null) return <div style={{ paddingLeft: depth * 16 }}>{prefix}<span className="text-dim">null</span></div>;
  if (typeof value === 'boolean') return <div style={{ paddingLeft: depth * 16 }}>{prefix}<span className="text-warning">{String(value)}</span></div>;
  if (typeof value === 'number') return <div style={{ paddingLeft: depth * 16 }}>{prefix}<span className="text-info">{value}</span></div>;
  if (typeof value === 'string') return <div style={{ paddingLeft: depth * 16 }}>{prefix}<span className="text-accent">{JSON.stringify(value)}</span></div>;

  if (Array.isArray(value)) {
    if (value.length === 0) return <div style={{ paddingLeft: depth * 16 }}>{prefix}<span className="text-dim">[]</span></div>;
    return (
      <div>
        <div
          style={{ paddingLeft: depth * 16 }}
          className="cursor-pointer hover:bg-hover-bg select-none"
          onClick={() => setExpanded(!expanded)}
        >
          <span className="text-dim mr-1">{expanded ? '▼' : '▶'}</span>
          {prefix}<span className="text-dim">[{value.length}]</span>
        </div>
        {expanded && value.map((item, i) => (
          <JsonNode key={i} value={item} depth={depth + 1} autoExpand={autoExpand} keyName={String(i)} />
        ))}
      </div>
    );
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return <div style={{ paddingLeft: depth * 16 }}>{prefix}<span className="text-dim">{'{}'}</span></div>;
    return (
      <div>
        <div
          style={{ paddingLeft: depth * 16 }}
          className="cursor-pointer hover:bg-hover-bg select-none"
          onClick={() => setExpanded(!expanded)}
        >
          <span className="text-dim mr-1">{expanded ? '▼' : '▶'}</span>
          {prefix}<span className="text-dim">{`{${entries.length}}`}</span>
        </div>
        {expanded && entries.map(([k, v]) => (
          <JsonNode key={k} value={v} depth={depth + 1} autoExpand={autoExpand} keyName={k} />
        ))}
      </div>
    );
  }

  return <div style={{ paddingLeft: depth * 16 }}>{prefix}{String(value)}</div>;
}
