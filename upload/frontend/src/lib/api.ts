/**
 * api.ts — SEMS API client functions
 * =================================
 * All API calls go through the /api/sems proxy route which forwards
 * requests to the Google Apps Script backend. Auth tokens are sent via
 * the X-Auth-Token header (or in the body for POST requests).
 */

import type {
  TelemetryLatestResponse,
  DevicesResponse,
  DeviceControlRequest,
  DeviceControlResponse,
  AlarmsResponse,
  AcknowledgeAlarmRequest,
  RulesResponse,
  SchedulesResponse,
  UsersResponse,
  GenericResponse,
  TelemetryHistoryResponse,
  ConfigResponse,
  Device,
  Schedule,
  AutomationRule,
} from '@/lib/types';

import { validateResponse, TelemetryLatestResponseSchema, DevicesResponseSchema, AlarmsResponseSchema, GenericResponseSchema } from '@/lib/schemas';

// ── Helpers ──

/** Get the auth token from localStorage */
function getToken(): string | null {
  return localStorage.getItem('sems_token');
}

/** Get CSRF token from cookie */
function getCsrfToken(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)sems-csrf=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/** Build headers for GET requests */
function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const token = getToken();
  if (token) {
    headers['X-Auth-Token'] = token;
  }
  return headers;
}

/** Build headers for POST requests (includes CSRF) */
function getPostHeaders(): Record<string, string> {
  const headers = getHeaders();
  const csrf = getCsrfToken();
  if (csrf) {
    headers['X-CSRF-Token'] = csrf;
  }
  return headers;
}

/** P2-API-03: Known API path allowlist */
const ALLOWED_PATHS: readonly string[] = [
  'api/telemetry/latest',
  'api/devices',
  'api/devices/control',
  'api/devices/rename',
  'api/alarms',
  'api/alarms/acknowledge',
  'api/rules',
  'api/rules/save',
  'api/rules/delete',
  'api/schedules',
  'api/schedules/save',
  'api/schedules/delete',
  'api/users',
  'api/users/create',
  'api/users/update',
  'api/users/auth',
  'api/config',
  'api/config/update',
  'api/config/set',
  'api/telemetry/history',
  'api/battery-health',
  'api/load-shedding',
  'api/notifications',
];

/**
 * Validate that a path is in the known API allowlist.
 * P2-API-02: Rejects paths that contain directory traversal or are not recognized.
 */
function validatePath(path: string | null): void {
  if (!path) return; // GET requests may have no path (root GAS endpoint)
  if (!ALLOWED_PATHS.includes(path)) {
    throw new Error(`Unknown API path: ${path}`);
  }
  // Block directory traversal
  if (path.includes('..') || path.startsWith('/')) {
    throw new Error(`Invalid API path: ${path}`);
  }
}

// ── Telemetry ──

/**
 * fetchLatestTelemetry — GET latest telemetry data from the device.
 * P2-API-03: Validates path against allowlist.
 */
export async function fetchLatestTelemetry(): Promise<TelemetryLatestResponse> {
  validatePath('api/telemetry/latest');
  const res = await fetch('/api/sems?path=api/telemetry/latest', {
    method: 'GET',
    headers: getHeaders(),
  signal: AbortSignal.timeout(15000),
  });
  const data = await res.json();
  return validateResponse(TelemetryLatestResponseSchema, data);
}

/**
 * fetchTelemetryHistory — GET telemetry history with optional time range and limit.
 * P2-API-03: Validates path against allowlist.
 * P2-API-03: Validates integer query params with Math.min/Math.max clamping.
 */
export async function fetchTelemetryHistory(params: {
  from?: string;
  to?: string;
  limit?: number;
}): Promise<TelemetryHistoryResponse> {
  validatePath('api/telemetry/history');
  const searchParams = new URLSearchParams();
  if (params.from) searchParams.set('from', params.from);
  if (params.to) searchParams.set('to', params.to);
  if (params.limit !== undefined) {
    // P2-API-03: Clamp limit between 1 and 10000
    const clamped = Math.min(10000, Math.max(1, params.limit));
    searchParams.set('limit', String(clamped));
  }
  const qs = searchParams.toString();
  const res = await fetch(`/api/sems?path=api/telemetry/history${qs ? `&${qs}` : ''}`, {
    method: 'GET',
    headers: getHeaders(),
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json();
  return data as TelemetryHistoryResponse;
}

// ── Devices ──

/**
 * fetchDevices — GET all registered devices.
 */
export async function fetchDevices(): Promise<DevicesResponse> {
  validatePath('api/devices');
  const res = await fetch('/api/sems?path=api/devices', {
    method: 'GET',
    headers: getHeaders(),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json();
  return validateResponse(DevicesResponseSchema, data);
}

/**
 * controlDevice — POST to toggle a device on/off.
 * P2-CSRF-01: Uses CSRF token. P2-CSRF-02: Rotates CSRF after success.
 */
export async function controlDevice(payload: DeviceControlRequest): Promise<DeviceControlResponse> {
  validatePath('api/devices/control');
  const res = await fetch('/api/sems?path=api/devices/control', {
    method: 'POST',
    headers: getPostHeaders(),
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  // P2-CSRF-02: Rotate CSRF token after successful mutation
  rotateCsrfToken();
  return data as DeviceControlResponse;
}

/**
 * renameDevice — POST to rename a device.
 * P2-CSRF-01: Uses CSRF token. P2-CSRF-02: Rotates CSRF after success.
 */
export async function renameDevice(payload: { id: string; name: string }): Promise<GenericResponse> {
  validatePath('api/devices/rename');
  const res = await fetch('/api/sems?path=api/devices/rename', {
    method: 'POST',
    headers: getPostHeaders(),
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  // P2-CSRF-02: Rotate CSRF token
  rotateCsrfToken();
  return data as GenericResponse;
}

// ── Alarms ──

/**
 * fetchAlarms — GET alarm list with optional filters.
 * P2-API-03: Clamps limit param.
 */
export async function fetchAlarms(params?: { limit?: string | number; page?: string | number; status?: string }): Promise<AlarmsResponse> {
  validatePath('api/alarms');
  const searchParams = new URLSearchParams();
  if (params?.limit !== undefined) {
    const clamped = Math.min(5000, Math.max(1, Number(params.limit)));
    searchParams.set('limit', String(clamped));
  }
  if (params?.page !== undefined) searchParams.set('page', String(params.page));
  if (params?.status) searchParams.set('status', params.status);
  const qs = searchParams.toString();
  const res = await fetch(`/api/sems?path=api/alarms${qs ? `&${qs}` : ''}`, {
    method: 'GET',
    headers: getHeaders(),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json();
  return validateResponse(AlarmsResponseSchema, data);
}

/**
 * acknowledgeAlarm — POST to acknowledge an alarm or multiple alarms.
 * P2-CSRF-01/02: Uses CSRF token and rotates after success.
 */
export async function acknowledgeAlarm(payload: AcknowledgeAlarmRequest): Promise<GenericResponse> {
  validatePath('api/alarms/acknowledge');
  const res = await fetch('/api/sems?path=api/alarms/acknowledge', {
    method: 'POST',
    headers: getPostHeaders(),
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  // P2-CSRF-02: Rotate CSRF token after successful mutation
  rotateCsrfToken();
  return data as GenericResponse;
}

// ── Rules (Automation) ──

/**
 * fetchRules — GET all automation rules.
 */
export async function fetchRules(): Promise<RulesResponse> {
  validatePath('api/rules');
  const res = await fetch('/api/sems?path=api/rules', {
    method: 'GET',
    headers: getHeaders(),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json();
  return data as RulesResponse;
}

/**
 * saveRule — POST to create or update an automation rule.
 * P2-CSRF-01/02: Uses CSRF token and rotates after success.
 */
export async function saveRule(payload: Record<string, unknown>): Promise<GenericResponse> {
  validatePath('api/rules/save');
  const res = await fetch('/api/sems?path=api/rules/save', {
    method: 'POST',
    headers: getPostHeaders(),
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  // P2-CSRF-02: Rotate CSRF token
  rotateCsrfToken();
  return data as GenericResponse;
}

/**
 * deleteRule — POST to delete an automation rule.
 * P2-CSRF-01/02: Uses CSRF token and rotates after success.
 */
export async function deleteRule(payload: { id: string }): Promise<GenericResponse> {
  validatePath('api/rules/delete');
  const res = await fetch('/api/sems?path=api/rules/delete', {
    method: 'POST',
    headers: getPostHeaders(),
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  // P2-CSRF-02: Rotate CSRF token
  rotateCsrfToken();
  return data as GenericResponse;
}

// ── Schedules ──

/**
 * fetchSchedules — GET all device schedules.
 */
export async function fetchSchedules(): Promise<SchedulesResponse> {
  validatePath('api/schedules');
  const res = await fetch('/api/sems?path=api/schedules', {
    method: 'GET',
    headers: getHeaders(),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json();
  return data as SchedulesResponse;
}

/**
 * saveSchedule — POST to create or update a schedule.
 * P2-CSRF-01/02: Uses CSRF token and rotates after success.
 */
export async function saveSchedule(payload: Record<string, unknown>): Promise<GenericResponse> {
  validatePath('api/schedules/save');
  const res = await fetch('/api/sems?path=api/schedules/save', {
    method: 'POST',
    headers: getPostHeaders(),
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  // P2-CSRF-02: Rotate CSRF token
  rotateCsrfToken();
  return data as GenericResponse;
}

/**
 * deleteSchedule — POST to delete a schedule.
 * P2-CSRF-01/02: Uses CSRF token and rotates after success.
 */
export async function deleteSchedule(payload: { id: string | number }): Promise<GenericResponse> {
  validatePath('api/schedules/delete');
  const res = await fetch('/api/sems?path=api/schedules/delete', {
    method: 'POST',
    headers: getPostHeaders(),
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  // P2-CSRF-02: Rotate CSRF token
  rotateCsrfToken();
  return data as GenericResponse;
}

// ── Users ──

/**
 * fetchUsers — GET all system users.
 */
export async function fetchUsers(): Promise<UsersResponse> {
  validatePath('api/users');
  const res = await fetch('/api/sems?path=api/users', {
    method: 'GET',
    headers: getHeaders(),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json();
  return data as UsersResponse;
}

/**
 * createUser — POST to create a new user.
 * P2-CSRF-01/02: Uses CSRF token and rotates after success.
 */
export async function createUser(payload: Record<string, unknown>): Promise<GenericResponse> {
  validatePath('api/users/create');
  const res = await fetch('/api/sems?path=api/users/create', {
    method: 'POST',
    headers: getPostHeaders(),
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  // P2-CSRF-02: Rotate CSRF token
  rotateCsrfToken();
  return data as GenericResponse;
}

/**
 * updateUser — POST to update a user (role, active, password).
 * P2-CSRF-01/02: Uses CSRF token and rotates after success.
 */
export async function updateUser(payload: Record<string, unknown>): Promise<GenericResponse> {
  validatePath('api/users/update');
  const res = await fetch('/api/sems?path=api/users/update', {
    method: 'POST',
    headers: getPostHeaders(),
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  // P2-CSRF-02: Rotate CSRF token
  rotateCsrfToken();
  return data as GenericResponse;
}

// ── Config ──

/**
 * fetchConfig — GET system configuration.
 */
export async function fetchConfig(): Promise<ConfigResponse> {
  validatePath('api/config');
  const res = await fetch('/api/sems?path=api/config', {
    method: 'GET',
    headers: getHeaders(),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json();
  return data as ConfigResponse;
}

/**
 * updateConfig — POST to update system configuration.
 * P2-CSRF-01/02: Uses CSRF token and rotates after success.
 */
export async function updateConfig(payload: Record<string, unknown>): Promise<GenericResponse> {
  validatePath('api/config/update');
  const res = await fetch('/api/sems?path=api/config/update', {
    method: 'POST',
    headers: getPostHeaders(),
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  // P2-CSRF-02: Rotate CSRF token
  rotateCsrfToken();
  return data as GenericResponse;
}

// ── Battery Health ──

/**
 * fetchBatteryHealth — GET battery health analysis data.
 */
export async function fetchBatteryHealth(): Promise<Record<string, unknown>> {
  validatePath('api/battery-health');
  const res = await fetch('/api/sems?path=api/battery-health', {
    method: 'GET',
    headers: getHeaders(),
    signal: AbortSignal.timeout(15000),
  });
  return res.json();
}

// ── Load Shedding ──

/**
 * fetchLoadShedding — GET load shedding status and thresholds.
 */
export async function fetchLoadShedding(): Promise<Record<string, unknown>> {
  validatePath('api/load-shedding');
  const res = await fetch('/api/sems?path=api/load-shedding', {
    method: 'GET',
    headers: getHeaders(),
    signal: AbortSignal.timeout(15000),
  });
  return res.json();
}

// ── Notifications ──

/**
 * fetchNotifications — GET notification history.
 */
export async function fetchNotifications(): Promise<Record<string, unknown>> {
  validatePath('api/notifications');
  const res = await fetch('/api/sems?path=api/notifications', {
    method: 'GET',
    headers: getHeaders(),
    signal: AbortSignal.timeout(15000),
  });
  return res.json();
}

// ── CSRF Token Rotation (P2-CSRF-02) ──

/**
 * rotateCsrfToken — replaces the sems-csrf cookie with a new random value.
 * Called after every successful mutating (POST) request.
 */
function rotateCsrfToken(): void {
  // Set cookie with same-site flag; middleware proxy will refresh it
  const newToken = crypto.randomUUID();
  const expires = new Date(Date.now() + 86400000).toUTCString();
  document.cookie = `sems-csrf=${newToken}; path=/; expires=${expires}; SameSite=Strict`;
}
