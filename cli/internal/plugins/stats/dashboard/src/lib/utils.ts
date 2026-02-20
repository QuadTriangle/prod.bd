export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const unit = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const index = Math.floor(Math.log(bytes) / Math.log(unit));
  return parseFloat((bytes / Math.pow(unit, index)).toFixed(1)) + ' ' + sizes[index];
}

export function formatLatency(ms: number): string {
  if (ms < 1) return '<1ms';
  if (ms < 1000) return Math.round(ms) + 'ms';
  return (ms / 1000).toFixed(2) + 's';
}

export function timeAgo(unix: number): string {
  const delta = Math.floor(Date.now() / 1000) - unix;
  if (delta < 60) return delta + 's ago';
  if (delta < 3600) return Math.floor(delta / 60) + 'm ago';
  if (delta < 86400) return Math.floor(delta / 3600) + 'h ago';
  return Math.floor(delta / 86400) + 'd ago';
}

export function statusColor(status: number): string {
  if (status < 300) return 'text-accent';
  if (status < 400) return 'text-warning';
  if (status < 500) return 'text-orange';
  return 'text-danger';
}

export function methodColor(method: string): string {
  const colorMap: Record<string, string> = {
    GET: 'bg-info/15 text-info',
    POST: 'bg-accent/15 text-accent',
    PUT: 'bg-warning/15 text-warning',
    PATCH: 'bg-orange/15 text-orange',
    DELETE: 'bg-danger/15 text-danger',
    HEAD: 'bg-purple/15 text-purple',
    OPTIONS: 'bg-purple/15 text-purple',
  };
  return colorMap[method] ?? 'bg-muted/15 text-muted';
}

export function contentTypeShort(contentType?: string): string {
  if (!contentType) return '';
  if (contentType.includes('json')) return 'JSON';
  if (contentType.includes('html')) return 'HTML';
  if (contentType.includes('xml')) return 'XML';
  if (contentType.includes('css')) return 'CSS';
  if (contentType.includes('javascript')) return 'JS';
  if (contentType.includes('image')) return 'IMG';
  if (contentType.includes('text')) return 'TXT';
  return contentType.split(';')[0].split('/').pop()?.toUpperCase().slice(0, 6) ?? '';
}

export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
