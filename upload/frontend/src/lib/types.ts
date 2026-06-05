// ===== SEMS Type Definitions =====
// Aligned with backend GAS data contract

// --- Auth ---
export interface AuthUser {
  id: string;
  username: string;
  role: 'admin' | 'technician' | 'viewer';
  active: boolean;
}

export interface AuthResponse {
  success: boolean;
  token?: string;
  user?: AuthUser;
  error?: string;
}

// --- Telemetry ---
export interface TelemetryData {
  timestamp: string;
  battery_voltage: number;
  battery_current: number;
  battery_power: number;
  soc_percent: number;
  cell1_v: number;
  cell2_v: number;
  cell3_v: number;
  cell4_v: number;
  cell5_v: number;
  cell6_v: number;
  cell7_v: number;
  cell8_v: number;
  inverter_current: number;
  inverter_power: number;
  room_temp: number;
  room_humidity: number;
  pir1: number;
  pir2: number;
  pir3: number;
  pir4: number;
  relay_states: string;    // JSON array string: [1,0,1,0,...]
  mosfet_states: string;   // JSON array string: [0,128,0,0]
  uptime_seconds: number;
  wifi_rssi: number;
  free_heap: number;
  load_shedding_active: number;
  [key: string]: unknown;
}

export interface TelemetryLatestResponse {
  success: boolean;
  data?: TelemetryData;
  error?: string;
  cached?: boolean;
}

// --- Devices ---
export interface Device {
  id: string;
  name: string;
  type: 'relay' | 'mosfet';
  channel: number;
  priority: number;
  mode: 'manual' | 'automatic' | 'schedule' | 'hybrid';
  state: number;
  last_changed: string;
}

export interface DevicesResponse {
  success: boolean;
  devices?: Device[];
  error?: string;
}

export interface DeviceControlRequest {
  id: string;
  state: 0 | 1;
  pwm_value?: number;
}

export interface DeviceControlResponse {
  success: boolean;
  message?: string;
  error?: string;
}

// --- Alarms ---
export interface Alarm {
  id?: number;  // Backend-generated alarm ID
  timestamp: string;
  type: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  acknowledged: boolean;
  acknowledged_at?: string;
  acknowledged_by?: string;
}

export interface AlarmsResponse {
  success: boolean;
  alarms?: Alarm[];
  total?: number;
  unacknowledged?: number;
  error?: string;
}

// --- Rules ---
export interface AutomationRule {
  id: string;
  enabled: boolean;
  target: string;
  logic: 'AND' | 'OR';
  conditions: string[];
  action: string;
  priority: number;
  created_at: string;
  updated_at: string;
}

export interface RulesResponse {
  success: boolean;
  rules?: AutomationRule[];
  error?: string;
}

// --- Schedules ---
export interface Schedule {
  id: string;
  enabled: boolean;
  target: string;
  action: string;
  time: string;
  days: number[];
  type: 'recurring' | 'once';
  date?: string;
  created_at: string;
}

export interface SchedulesResponse {
  success: boolean;
  schedules?: Schedule[];
  error?: string;
}

// --- Rule Conditions (UI model for the rule builder) ---
export interface RuleCondition {
  sensor: string;
  operator: '>' | '<' | '>=' | '<=' | '==' | '!=';
  value: number;
}

export interface RuleAction {
  target: string;
  action: 'on' | 'off';
}

// --- Config ---
export interface ConfigItem {
  key: string;
  value: string;
  description?: string;
  updated_at?: string;
}

export interface ConfigResponse {
  success: boolean;
  count?: number;
  configs?: ConfigItem[];
  source?: string;
  error?: string;
}

// --- Users ---
export interface User {
  id: string;
  username: string;
  role: 'admin' | 'technician' | 'viewer';
  created_at: string;
  active: boolean;
  last_login?: string;
}

export interface UsersResponse {
  success: boolean;
  users?: User[];
  error?: string;
}

export interface CreateUserRequest {
  username: string;
  password: string;
  role: 'admin' | 'technician' | 'viewer';
}

export interface UpdateUserRequest {
  id: string;
  role?: 'admin' | 'technician' | 'viewer';
  active?: boolean;
  password?: string;
}

// --- Telemetry History ---
export interface TelemetryHistoryResponse {
  success: boolean;
  data?: TelemetryData[];
  count?: number;
  from?: string;
  to?: string;
  downsampled?: boolean;
  error?: string;
}

// --- Generic API Response ---
export interface GenericResponse {
  success: boolean;
  message?: string;
  error?: string;
}

// --- Alarm Actions ---
export interface AcknowledgeAlarmRequest {
  id?: string;
  ids?: string[];
  acknowledge_all?: boolean;
}

// --- API Error ---
export interface ApiError {
  success: false;
  error: string;
}

// --- Dashboard Card Data (derived) ---

// Available condition sensors for automation rules
// Names must match firmware parser keywords
export const CONDITION_SENSORS = [
  { value: 'battery_voltage', label: 'Battery Voltage', unit: 'V' },
  { value: 'battery_current', label: 'Battery Current', unit: 'A' },
  { value: 'soc_percent', label: 'Battery SOC', unit: '%' },
  { value: 'inverter_current', label: 'Inverter Current', unit: 'A' },
  { value: 'inverter_power', label: 'Inverter Power', unit: 'W' },
  { value: 'room_temp', label: 'Room Temperature', unit: '°C' },
  { value: 'room_humidity', label: 'Room Humidity', unit: '%' },
  { value: 'wifi_rssi', label: 'WiFi RSSI', unit: 'dBm' },
  { value: 'load_shedding_active', label: 'Load Shedding', unit: '' },
  // Individual cells — backend uses cell1_v, cell2_v, etc.
  ...[1,2,3,4,5,6,7,8].map(n => ({ value: `cell${n}_v`, label: `Cell ${n} Voltage`, unit: 'V' })),
  // PIR sensors — backend uses pir1, pir2, etc.
  ...[1,2,3,4].map(n => ({ value: `pir${n}`, label: `PIR Zone ${String.fromCharCode(64+n)}`, unit: '' })),
] as const;

export const CONDITION_OPERATORS = [
  { value: '>', label: '>' },
  { value: '<', label: '<' },
  { value: '>=', label: '>=' },
  { value: '<=', label: '<=' },
  { value: '==', label: '=' },
  { value: '!=', label: '!=' },
] as const;

// Days: 0=Sunday, 1=Monday, ..., 6=Saturday (backend format)
export const DAYS_OF_WEEK = [
  { value: 0, label: 'Min', labelShort: 'M' },
  { value: 1, label: 'Sen', labelShort: 'S' },
  { value: 2, label: 'Sel', labelShort: 'S' },
  { value: 3, label: 'Rab', labelShort: 'R' },
  { value: 4, label: 'Kam', labelShort: 'K' },
  { value: 5, label: 'Jum', labelShort: 'J' },
  { value: 6, label: 'Sab', labelShort: 'S' },
] as const;

export interface CellVoltage {
  cell: number;
  voltage: number;
  status: 'good' | 'warning' | 'danger';
}

export interface RelayState {
  relay: number;
  name: string;
  state: boolean;
}

export interface PIRState {
  sensor: number;
  motion: boolean;
}
