'use client';

import type {
  TelemetryLatestResponse,
  TelemetryHistoryResponse,
  DevicesResponse,
  DeviceControlResponse,
  DeviceControlRequest,
  AlarmsResponse,
  RulesResponse,
  SchedulesResponse,
  ConfigResponse,
  UsersResponse,
  CreateUserRequest,
  UpdateUserRequest,
  GenericResponse,
  AcknowledgeAlarmRequest,
} from './types';

// All API requests go through the Next.js proxy at /api/sems.
// The proxy reads GAS_SCRIPT_URL from server-side environment variables.

/**
 * Core fetch wrapper. Sends requests through the Next.js proxy at /api/sems.
 * The proxy extracts `path` and forwards extra params to the GAS backend.
 *
 * @param path - API endpoint path WITHOUT api/ prefix (e.g., 'telemetry/latest')
 *               — the api/ prefix is added automatically
 * @param queryParams - Optional extra query parameters (forwarded as separate ?key=value)
 * @param options - Standard fetch options (method, body, headers)
 */
async function semsFetch<T>(
  path: string,
  queryParams?: Record<string, string>,
  options: RequestInit = {},
): Promise<T> {
  const token = typeof window !== 'undefined'
    ? localStorage.getItem('sems_token')
    : null;

  // Prepend api/ prefix if not already present
  const fullPath = path.startsWith('api/') ? path : `api/${path}`;

  // Build proxy URL with path and any extra query params as separate parameters
  const proxyParams = new URLSearchParams({ path: fullPath });
  if (queryParams) {
    for (const [key, value] of Object.entries(queryParams)) {
      if (value !== undefined && value !== '') {
        proxyParams.set(key, value);
      }
    }
  }

  const url = `/api/sems?${proxyParams.toString()}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-Auth-Token': token } : {}),
      ...options.headers,
    },
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`API Error ${res.status}: ${errorText}`);
  }

  return res.json();
}

// ===== Telemetry =====
export async function fetchLatestTelemetry(): Promise<TelemetryLatestResponse> {
  return semsFetch<TelemetryLatestResponse>('telemetry/latest');
}

export async function fetchTelemetryHistory(params: {
  from?: string;
  to?: string;
  limit?: number;
}): Promise<TelemetryHistoryResponse> {
  const qp: Record<string, string> = {};
  if (params.from) qp.from = params.from;
  if (params.to) qp.to = params.to;
  if (params.limit) qp.limit = String(params.limit);
  return semsFetch<TelemetryHistoryResponse>('telemetry/history', qp);
}

// ===== Devices =====
export async function fetchDevices(): Promise<DevicesResponse> {
  return semsFetch<DevicesResponse>('devices');
}

export async function controlDevice(data: DeviceControlRequest): Promise<DeviceControlResponse> {
  return semsFetch<DeviceControlResponse>('devices/control', undefined, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function renameDevice(data: { id: string; name: string }): Promise<DeviceControlResponse> {
  return semsFetch<DeviceControlResponse>('device/rename', undefined, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ===== Alarms =====
export async function fetchAlarms(params?: Record<string, string>): Promise<AlarmsResponse> {
  return semsFetch<AlarmsResponse>('alarms', params);
}

export async function acknowledgeAlarm(data: AcknowledgeAlarmRequest): Promise<GenericResponse> {
  return semsFetch<GenericResponse>('alarms/acknowledge', undefined, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ===== Rules =====
export async function fetchRules(): Promise<RulesResponse> {
  return semsFetch<RulesResponse>('rules/get');
}

export async function saveRule(data: {
  id?: string;
  enabled: boolean;
  target: string;
  logic: 'AND' | 'OR';
  conditions: string[];
  action: string;
  priority: number;
}): Promise<GenericResponse> {
  return semsFetch<GenericResponse>('rules/update', undefined, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function deleteRule(data: { id: string }): Promise<GenericResponse> {
  return semsFetch<GenericResponse>('rules/delete', undefined, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ===== Schedules =====
export async function fetchSchedules(): Promise<SchedulesResponse> {
  return semsFetch<SchedulesResponse>('schedules/get');
}

export async function saveSchedule(data: {
  id?: string;
  enabled: boolean;
  target: string;
  action: string;
  time: string;
  days: number[];
  type: 'recurring' | 'once';
  date?: string;
}): Promise<GenericResponse> {
  return semsFetch<GenericResponse>('schedules/update', undefined, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function deleteSchedule(data: { id: string }): Promise<GenericResponse> {
  return semsFetch<GenericResponse>('schedules/delete', undefined, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ===== Config =====
export async function fetchConfig(): Promise<ConfigResponse> {
  return semsFetch<ConfigResponse>('config/get');
}

export async function updateConfig(data: {
  updates?: Array<{ key: string; value: string }>;
  send_test_email?: string;
  [key: string]: unknown;
}): Promise<GenericResponse> {
  return semsFetch<GenericResponse>('config/update', undefined, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ===== Users =====
export async function fetchUsers(): Promise<UsersResponse> {
  return semsFetch<UsersResponse>('users');
}

export async function createUser(data: CreateUserRequest): Promise<GenericResponse> {
  return semsFetch<GenericResponse>('users/create', undefined, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateUser(data: UpdateUserRequest): Promise<GenericResponse> {
  return semsFetch<GenericResponse>('users/update', undefined, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}
