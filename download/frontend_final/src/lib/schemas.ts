/**
 * Zod schemas for SEMS API response validation.
 * These schemas parse and validate backend responses, providing runtime
 * type safety on top of TypeScript's compile-time checking.
 */
import { z } from 'zod';

// ── Telemetry ─
export const TelemetryDataSchema = z.object({
  timestamp: z.string(),
  battery_voltage: z.number(),
  battery_current: z.number(),
  battery_power: z.number(),
  soc_percent: z.number(),
  cell1_v: z.number(),
  cell2_v: z.number(),
  cell3_v: z.number(),
  cell4_v: z.number(),
  cell5_v: z.number(),
  cell6_v: z.number(),
  cell7_v: z.number(),
  cell8_v: z.number(),
  inverter_current: z.number(),
  inverter_power: z.number(),
  room_temp: z.number(),
  room_humidity: z.number(),
  pir1: z.number(),
  pir2: z.number(),
  pir3: z.number(),
  pir4: z.number(),
  relay_states: z.string(),
  mosfet_states: z.string(),
  uptime_seconds: z.number(),
  wifi_rssi: z.number(),
  free_heap: z.number(),
  load_shedding_active: z.number(),
}).passthrough();

export type ValidatedTelemetryData = z.infer<typeof TelemetryDataSchema>;

export const TelemetryLatestResponseSchema = z.object({
  success: z.boolean(),
  data: TelemetryDataSchema.optional(),
  error: z.string().optional(),
  cached: z.boolean().optional(),
});

// ── Devices ──
export const DeviceInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['relay', 'mosfet']),
  channel: z.number(),
  priority: z.number(),
  mode: z.enum(['manual', 'automatic', 'schedule', 'hybrid']),
  state: z.number(),
  last_changed: z.string(),
});

export type ValidatedDeviceInfo = z.infer<typeof DeviceInfoSchema>;

export const DevicesResponseSchema = z.object({
  success: z.boolean(),
  devices: z.array(DeviceInfoSchema).optional(),
  error: z.string().optional(),
});

// ── Alarms ──
export const AlarmInfoSchema = z.object({
  id: z.number().optional(),
  timestamp: z.string(),
  type: z.string(),
  severity: z.enum(['info', 'warning', 'critical']),
  message: z.string(),
  acknowledged: z.boolean(),
  acknowledged_at: z.string().optional(),
  acknowledged_by: z.string().optional(),
});

export type ValidatedAlarmInfo = z.infer<typeof AlarmInfoSchema>;

export const AlarmsResponseSchema = z.object({
  success: z.boolean(),
  alarms: z.array(AlarmInfoSchema).optional(),
  total: z.number().optional(),
  unacknowledged: z.number().optional(),
  error: z.string().optional(),
});

// ── Generic Response ──
export const GenericResponseSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
  error: z.string().optional(),
});

// ── Rules Response (T3-FE-006) ──
export const RuleInfoSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  name: z.string().optional(),
  condition: z.string().optional(),
  action: z.string().optional(),
  enabled: z.union([z.boolean(), z.number()]).optional(),
  created_at: z.string().optional(),
}).passthrough();

export const RulesResponseSchema = z.object({
  success: z.boolean(),
  rules: z.array(RuleInfoSchema).optional(),
  error: z.string().optional(),
});

// ── Schedules Response (T3-FE-006) ──
export const ScheduleInfoSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  device_id: z.string().optional(),
  schedule_type: z.string().optional(),
  start_time: z.string().optional(),
  end_time: z.string().optional(),
  days: z.string().optional(),
  enabled: z.union([z.boolean(), z.number()]).optional(),
}).passthrough();

export const SchedulesResponseSchema = z.object({
  success: z.boolean(),
  schedules: z.array(ScheduleInfoSchema).optional(),
  error: z.string().optional(),
});

// ── Users Response (T3-FE-006) ──
export const UserInfoSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  username: z.string().optional(),
  name: z.string().optional(),
  role: z.string().optional(),
  active: z.union([z.boolean(), z.number()]).optional(),
  created_at: z.string().optional(),
}).passthrough();

export const UsersResponseSchema = z.object({
  success: z.boolean(),
  users: z.array(UserInfoSchema).optional(),
  error: z.string().optional(),
});

// ── Config Response (T3-FE-006) ──
export const ConfigItemSchema = z.object({
  key: z.string(),
  value: z.string(),
}).passthrough();

export const ConfigResponseSchema = z.object({
  success: z.boolean(),
  configs: z.array(ConfigItemSchema).optional(),
  error: z.string().optional(),
});

// ── Validation Helper ──
/**
 * validateResponse — parses a JSON response with a given Zod schema.
 * Returns typed data on success, throws a descriptive error on failure.
 */
export function validateResponse<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const firstError = result.error.issues[0];
    const message = firstError
      ? `${firstError.path.join('.')}: ${firstError.message}`
      : 'Response validation failed';
    throw new Error(`Validation error: ${message}`);
  }
  return result.data;
}
