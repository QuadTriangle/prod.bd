import type {
  Tunnel,
  RequestEntry,
  Summary,
  InterceptRule,
  PausedRequest,
  SavedRequest,
  SendResult,
} from './types';

const API_BASE = '';

interface TunnelsResponse {
  tunnels: Tunnel[];
}

interface SummaryResponse {
  summary: Summary;
}

interface RequestsResponse {
  requests: RequestEntry[];
}

interface InterceptsResponse {
  rules: InterceptRule[];
}

interface PausedResponse {
  paused: PausedRequest[] | Record<string, PausedRequest>;
}

interface SavedResponse {
  saved: SavedRequest[];
}

interface ResumeResponse {
  resumed: string;
}

interface CurlResponse {
  curl: string;
}

interface ClearResponse {
  cleared: boolean;
}

interface SendPayload {
  subdomain: string;
  method: string;
  path: string;
  headers: Record<string, string[]>;
  body: string;
}

interface ResumeEdits {
  method?: string;
  path?: string;
  headers?: Record<string, string[]>;
  body?: string;
}

async function get<T>(path: string): Promise<T> {
  const response = await fetch(API_BASE + path);

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json();
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(API_BASE + path, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json();
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(API_BASE + path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json();
}

async function del(path: string): Promise<void> {
  const response = await fetch(API_BASE + path, { method: 'DELETE' });

  if (!response.ok) {
    throw new Error(await response.text());
  }
}

function normalizePaused(response: PausedResponse): PausedRequest[] {
  const paused = response.paused;

  if (Array.isArray(paused)) {
    return paused;
  }

  return Object.entries(paused).map(([id, request]) => ({ ...request, id }));
}

export const api = {
  fetchTunnels: (): Promise<Tunnel[]> =>
    get<TunnelsResponse>('/api/stats/tunnels')
      .then((response) => response.tunnels ?? []),

  fetchSummary: (): Promise<Summary> =>
    get<SummaryResponse>('/api/stats/summary')
      .then((response) => response.summary),

  fetchRequests: (subdomain: string, limit = 200): Promise<RequestEntry[]> =>
    get<RequestsResponse>(`/api/stats/requests?subdomain=${subdomain}&limit=${limit}`)
      .then((response) => response.requests ?? []),

  fetchIntercepts: (): Promise<InterceptRule[]> =>
    get<InterceptsResponse>('/api/stats/intercepts')
      .then((response) => response.rules ?? []),

  fetchPaused: (): Promise<PausedRequest[]> =>
    get<PausedResponse>('/api/stats/paused')
      .then(normalizePaused),

  fetchSaved: (): Promise<SavedRequest[]> =>
    get<SavedResponse>('/api/stats/saved')
      .then((response) => response.saved ?? []),

  replay: (id: number): Promise<SendResult> =>
    post<SendResult>(`/api/stats/replay/${id}`),

  send: (payload: SendPayload): Promise<SendResult> =>
    post<SendResult>('/api/stats/send', payload),

  addIntercept: (rule: Partial<InterceptRule>): Promise<InterceptRule> =>
    post<InterceptRule>('/api/stats/intercepts', rule),

  updateIntercept: (id: number, rule: Partial<InterceptRule>): Promise<InterceptRule> =>
    put<InterceptRule>(`/api/stats/intercepts/${id}`, rule),

  deleteIntercept: (id: number): Promise<void> =>
    del(`/api/stats/intercepts/${id}`),

  resume: (id: string, edits?: ResumeEdits): Promise<ResumeResponse> =>
    post<ResumeResponse>(`/api/stats/resume/${id}`, edits),

  addSaved: (savedRequest: Partial<SavedRequest>): Promise<SavedRequest> =>
    post<SavedRequest>('/api/stats/saved', savedRequest),

  deleteSaved: (id: number): Promise<void> =>
    del(`/api/stats/saved/${id}`),

  getCurl: (id: number): Promise<string> =>
    get<CurlResponse>(`/api/stats/curl/${id}`)
      .then((response) => response.curl),

  clearLogs: (): Promise<ClearResponse> =>
    post<ClearResponse>('/api/stats/clear'),
};
