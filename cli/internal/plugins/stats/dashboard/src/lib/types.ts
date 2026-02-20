export interface Tunnel {
  subdomain: string;
  port: number;
  total_requests: number;
  error_count: number;
  avg_latency: number;
  max_latency: number;
  min_latency: number;
  total_bytes_in: number;
  total_bytes_out: number;
  connected_at: number;
}

export interface UpstreamRoute {
  id: number;
  subdomain: string;
  path_pattern: string;
  methods?: string[];
  target: string;
  rewrite?: string;
  enabled: boolean;
  priority: number;
}

export interface RequestEntry {
  id: number;
  subdomain: string;
  method: string;
  path: string;
  status: number;
  latency_ms: number;
  bytes_in: number;
  bytes_out: number;
  created_at: number;
  request_headers?: Record<string, string[]>;
  request_body?: string;
  response_headers?: Record<string, string[]>;
  response_body?: string;
  truncated?: boolean;
  upstream?: string;
  tags?: string[];
}

export interface Summary {
  active_tunnels: number;
  total_requests: number;
  total_errors: number;
  avg_latency: number;
  total_bytes_in: number;
  total_bytes_out: number;
}

export interface InterceptRule {
  id: number;
  path_pattern: string;
  methods?: string[];
  match_headers?: Record<string, string>;
  action: string;
  set_headers?: Record<string, string>;
  set_status?: number;
  set_body?: string;
  add_latency_ms?: number;
  enabled: boolean;
}

export interface PausedRequest {
  id: string;
  method: string;
  path: string;
  headers?: Record<string, string[]>;
  body?: string;
  paused_at: number;
}

export interface SavedRequest {
  id: number;
  name: string;
  method: string;
  path: string;
  params?: KVPair[];
  headers?: KVPair[];
  body_type: string;
  body?: string;
  assertions?: Assertion[];
  created: number;
}

export interface KVPair {
  key: string;
  value: string;
  enabled: boolean;
}

export interface ComposerState {
  method: string;
  path: string;
  params: KVPair[];
  headers: KVPair[];
  bodyType: string;
  body: string;
  name: string;
  assertions: Assertion[];
}

export interface SendResult {
  status: number;
  latency_ms: number;
  headers: Record<string, string[]>;
  body: string;
}

export interface Assertion {
  target: string;   // "status" | "latency" | "header" | "body_contains" | "body_json"
  property: string; // header name or JSON path
  operator: string; // "eq" | "neq" | "lt" | "gt" | "contains" | "exists"
  value: string;
}

export interface AssertionResult {
  assertion: Assertion;
  passed: boolean;
  actual: string;
  error?: string;
}

export interface WSMessage {
  id: number;
  session_id: string;
  subdomain: string;
  direction: string; // "in" | "out"
  is_text: boolean;
  payload: string;
  size: number;
  timestamp: number;
}

export interface RunResult {
  name: string;
  method: string;
  path: string;
  status: number;
  latency_ms: number;
  assertions?: AssertionResult[];
  error?: string;
}
