/**
 * Config.gs — SEMS Backend Configuration
 * ======================================
 * Central configuration for the Smart Energy Management System backend.
 * Contains spreadsheet ID, sheet names, column definitions, thresholds,
 * and all system-wide constants.
 */

// ============================================================
// SPREADSHEET CONFIGURATION
// ============================================================

/**
 * REPLACE THIS with your actual Google Spreadsheet ID.
 * Found in the URL: https://docs.google.com/spreadsheets/d/{THIS_IS_THE_ID}/edit
 */
var SPREADSHEET_ID = 'REPLACE_WITH_YOUR_SPREADSHEET_ID';

/** Get the active spreadsheet (for script-bound projects) */
function getSpreadsheet_() {
  if (SPREADSHEET_ID === 'REPLACE_WITH_YOUR_SPREADSHEET_ID') {
    console.warn('Config: SPREADSHEET_ID is still a placeholder. Using active spreadsheet.');
  }
  try {
    return SpreadsheetApp.openById(SPREADSHEET_ID) ||
           SpreadsheetApp.getActiveSpreadsheet();
  } catch (e) {
    console.error('Config: Failed to open spreadsheet - ' + e.message);
    return SpreadsheetApp.getActiveSpreadsheet();
  }
}

// ============================================================
// SHEET NAMES
// ============================================================

var SHEET = {
  DEVICES:           'devices',
  TELEMETRY_LIVE:    'telemetry_live',
  TELEMETRY_HISTORY: 'telemetry_history',
  AUTOMATION_RULES:  'automation_rules',
  SCHEDULES:         'schedules',
  USERS:             'users',
  ALARMS:            'alarms',
  CONFIGURATIONS:    'configurations'
};

// ============================================================
// COLUMN HEADERS — devices
// ============================================================

var DEVICES_HEADERS = [
  'id', 'name', 'type', 'channel', 'priority', 'mode', 'state', 'last_changed'
];

// ============================================================
// COLUMN HEADERS — telemetry_live & telemetry_history
// ============================================================

var TELEMETRY_HEADERS = [
  'timestamp',
  'battery_voltage', 'battery_current', 'battery_power', 'soc_percent',
  'cell1_v', 'cell2_v', 'cell3_v', 'cell4_v',
  'cell5_v', 'cell6_v', 'cell7_v', 'cell8_v',
  'inverter_current', 'inverter_power',
  'room_temp', 'room_humidity',
  'pir1', 'pir2', 'pir3', 'pir4',
  'relay_states', 'mosfet_states',
  'uptime_seconds', 'wifi_rssi', 'free_heap',
  'load_shedding_active'
];

// ============================================================
// COLUMN HEADERS — automation_rules
// ============================================================

var RULES_HEADERS = [
  'id', 'enabled', 'target', 'logic', 'conditions', 'action',
  'priority', 'created_at', 'updated_at'
];

// ============================================================
// COLUMN HEADERS — schedules
// ============================================================

var SCHEDULES_HEADERS = [
  'id', 'enabled', 'target', 'action', 'time', 'days',
  'type', 'date', 'created_at'
];

// ============================================================
// COLUMN HEADERS — users
// SECURITY v1.1.0: Added 'must_change_password' column
// ============================================================

var USERS_HEADERS = [
  'id', 'username', 'password_hash', 'role', 'created_at', 'active', 'must_change_password'
];

// ============================================================
// COLUMN HEADERS — alarms
// ============================================================

var ALARMS_HEADERS = [
  'id', 'timestamp', 'type', 'severity', 'message', 'acknowledged'
];

// ============================================================
// COLUMN HEADERS — configurations
// ============================================================

var CONFIG_HEADERS = [
  'key', 'value', 'description', 'updated_at'
];

// ============================================================
// ALARM THRESHOLDS
// ============================================================

var THRESHOLDS = {
  LOW_BATTERY_VOLTAGE:      21.0,    // Volts — trigger low_battery alarm
  OVERVOLTAGE:              29.2,    // Volts — trigger overvoltage alarm
  OVERLOAD_CURRENT:         80.0,    // Amps  — trigger overload alarm (matched to firmware)
  SOC_LOW:                  20,      // %     — additional low SOC warning
  SOC_CRITICAL:             10,      // %     — critical battery level
  TEMP_HIGH:                45,      // °C    — high temperature warning
  WIFI_RSSI_WEAK:           -80,     // dBm   — weak WiFi signal
  HEAP_LOW:                 20000    // Bytes — low free heap warning
};

// ============================================================
// ALARM TYPES & SEVERITIES
// ============================================================

var ALARM_TYPE = {
  LOW_BATTERY:    'low_battery',
  OVERLOAD:       'overload',
  SENSOR_FAILURE: 'sensor_failure',
  RELAY_FAULT:    'relay_fault',
  OVERVOLTAGE:    'overvoltage',
  SYSTEM:         'system'
};

var ALARM_SEVERITY = {
  CRITICAL: 'critical',
  WARNING:  'warning',
  INFO:     'info'
};

// ============================================================
// DEVICE TYPES & MODES
// ============================================================

var DEVICE_TYPE = {
  RELAY: 'relay',
  MOSFET: 'mosfet'
};

var DEVICE_MODE = {
  MANUAL:    'manual',
  AUTOMATIC: 'automatic',
  SCHEDULE:  'schedule',
  HYBRID:    'hybrid'
};

var DEVICE_PRIORITY = {
  // 0 = highest (keep alive), 3 = lowest (first to shed)
  CRITICAL: 0,
  HIGH:     1,
  MEDIUM:   2,
  LOW:      3
};

// ============================================================
// USER ROLES
// ============================================================

var USER_ROLE = {
  ADMIN:      'admin',
  TECHNICIAN: 'technician',
  VIEWER:     'viewer'
};

var ROLE_PERMISSIONS = {
  'admin':      ['read', 'write', 'control', 'users', 'config'],
  'technician': ['read', 'write', 'control'],
  'viewer':     ['read']
};

// ============================================================
// AUTHENTICATION CONSTANTS
// SECURITY v1.1.0: Added HASH_ROUNDS and MAX_SESSION_LIFETIME_MS
// ============================================================

var AUTH = {
  TOKEN_EXPIRY_MS:           6 * 60 * 60 * 1000,   // 6 hours — matches CacheService max TTL (21600s)
  MAX_SESSION_LIFETIME_MS:    24 * 60 * 60 * 1000,  // 24 hours hard limit (rejects stale sessions)
  SESSION_CACHE_PREFIX:      'sems_session_',
  SESSION_INDEX_PREFIX:      'sems_sessidx_',      // B-04: per-user session index cache key
  DEVICE_TOKEN_CACHE_KEY:    'sems_device_token',
  TOKEN_LENGTH:              64,
  HASH_ROUNDS:               1000   // PBKDF2-like iterations for password hashing
};

/** Default admin password — change immediately after initial setup */
var DEFAULT_ADMIN_PASSWORD = 'changeme_immediately';

// ============================================================
// SENSITIVE CONFIG KEYS (filtered from GET responses)
// SECURITY v1.1.0: Keys whose values are masked as "***" in API responses
// ============================================================

var SENSITIVE_KEYS = [
  'device_token',
  'admin_password',
  'default_admin_password',
  'secret_key',
  'api_key',
  'private_key'
];

// ============================================================
// CACHE SETTINGS
// ============================================================

var CACHE = {
  LATEST_TELEMETRY_KEY:  'sems_telemetry_latest',
  LATEST_TELEMETRY_TTL:  120,   // seconds — how long cached telemetry lives
  DEVICES_CACHE_KEY:     'sems_devices_list',
  DEVICES_CACHE_TTL:     300,   // seconds
  CONFIG_CACHE_KEY:      'sems_config_all',
  CONFIG_CACHE_TTL:      600,   // seconds
  RULES_CACHE_KEY:       'sems_rules_all',
  RULES_CACHE_TTL:       300,   // seconds
  SCHEDULES_CACHE_KEY:   'sems_schedules_all',
  SCHEDULES_CACHE_TTL:   300,   // seconds
  TELEMETRY_DEDUP_KEY:   'sems_last_telemetry_hash',
  TELEMETRY_DEDUP_TTL:   30,    // seconds
  CLEANUP_COUNTER_KEY:   'sems_cleanup_counter'  // Counter for cleanup optimization
};

// ============================================================
// EMAIL NOTIFICATION SETTINGS
// ============================================================

var EMAIL_CONFIG = {
  MAX_PER_TYPE_INTERVAL_MS: 30 * 60 * 1000,  // 30 minutes between same-type emails
  MAX_EMAILS_PER_DAY:       20,
  RATE_LIMIT_CACHE_PREFIX:  'sems_email_',
  DAILY_COUNTER_CACHE_KEY:  'sems_email_daily_count',
  DAILY_COUNTER_RESET_MS:   24 * 60 * 60 * 1000  // 24 hours
};

// ============================================================
// CLEANUP SETTINGS
// ============================================================

var CLEANUP = {
  TELEMETRY_HISTORY_MAX_AGE_DAYS: 30,
  ALARMS_MAX_AGE_DAYS:            90,
  LOCK_TIMEOUT_MS:                5000,   // 5 seconds (reduced from 10s)
  MAX_BATCH_ROWS:                 500,    // B-09: max rows deleted per cleanup run
  RUN_EVERY_N_POSTS:              10      // Run cleanup every Nth telemetry POST
};

// ============================================================
// DEFAULT CONFIGURATIONS
// ============================================================

var DEFAULT_CONFIGS = [
  { key: 'device_token',       value: 'sems_device_token_change_me_2024', description: 'API token for ESP32 device authentication' },
  { key: 'notification_email', value: '',                                   description: 'Email address for alarm notifications' },
  { key: 'telemetry_interval', value: '15',                                 description: 'Telemetry reporting interval in seconds' },
  { key: 'voltage_calibration',value: '1.0',                                description: 'Battery voltage calibration multiplier' },
  { key: 'current_calibration',value: '1.0',                                description: 'Battery current calibration multiplier' },
  { key: 'temp_offset',       value: '0.0',                                description: 'Temperature sensor offset in Celsius' },
  { key: 'soc_low_threshold', value: '20',                                 description: 'Low SoC warning threshold (%)' },
  { key: 'soc_critical_threshold', value: '10',                            description: 'Critical SoC threshold (%)' },
  { key: 'max_load_current',  value: '80',                                 description: 'Maximum allowed load current (A)' },
  { key: 'load_shedding_enabled', value: 'true',                           description: 'Enable automatic load shedding' },
  { key: 'wifi_ssid',         value: '',                                   description: 'WiFi SSID (for display only)' },
  { key: 'system_name',       value: 'SEMS - Smart Energy Management System', description: 'System display name' },
  { key: 'timezone',          value: 'Asia/Jakarta',                       description: 'System timezone' },
  { key: 'data_retention_days', value: '30',                               description: 'Telemetry history retention (days)' },
  { key: 'alarm_retention_days', value: '90',                             description: 'Alarm history retention (days)' },
  { key: 'email_notifications',  value: '1',                              description: 'Enable/disable email alarm notifications (1=on, 0=off)' },
  { key: 'low_battery_voltage',  value: '21',                              description: 'Low battery voltage threshold (V)' },
  { key: 'overvoltage_threshold',value: '29.2',                            description: 'Overvoltage threshold (V)' },
  { key: 'overload_current',    value: '30',                              description: 'Overload current threshold (A)' },
  { key: 'quiet_hours_enabled', value: '0',                               description: 'Enable quiet hours for email notifications (1=on, 0=off)' },
  { key: 'quiet_hours_start',   value: '22',                              description: 'Quiet hours start time (hour, 0-23)' },
  { key: 'quiet_hours_end',     value: '06',                              description: 'Quiet hours end time (hour, 0-23)' },
  { key: 'sensor_failure_timeout', value: '30',                            description: 'Sensor failure timeout (seconds)' }
];

// ============================================================
// DEFAULT DEVICES
// ============================================================

var DEFAULT_DEVICES = [
  { id: 'relay_1',  name: 'Lighting - Main',     type: 'relay',  channel: 0,  priority: 0, mode: 'automatic' },
  { id: 'relay_2',  name: 'Lighting - Bedroom',   type: 'relay',  channel: 1,  priority: 1, mode: 'automatic' },
  { id: 'relay_3',  name: 'Lighting - Kitchen',   type: 'relay',  channel: 2,  priority: 1, mode: 'automatic' },
  { id: 'relay_4',  name: 'Lighting - Bathroom',  type: 'relay',  channel: 3,  priority: 1, mode: 'automatic' },
  { id: 'relay_5',  name: 'Lighting - Outdoor',   type: 'relay',  channel: 4,  priority: 2, mode: 'schedule' },
  { id: 'relay_6',  name: 'Fan - Living Room',    type: 'relay',  channel: 5,  priority: 1, mode: 'automatic' },
  { id: 'relay_7',  name: 'Fan - Bedroom',        type: 'relay',  channel: 6,  priority: 1, mode: 'automatic' },
  { id: 'relay_8',  name: 'Water Pump',           type: 'relay',  channel: 7,  priority: 0, mode: 'hybrid' },
  { id: 'relay_9',  name: 'Router / Modem',       type: 'relay',  channel: 8,  priority: 0, mode: 'automatic' },
  { id: 'relay_10', name: 'TV / Entertainment',   type: 'relay',  channel: 9,  priority: 2, mode: 'manual' },
  { id: 'relay_11', name: 'Phone Charger',        type: 'relay',  channel: 10, priority: 2, mode: 'manual' },
  { id: 'relay_12', name: 'Kitchen Appliance',    type: 'relay',  channel: 11, priority: 2, mode: 'manual' },
  { id: 'relay_13', name: 'Extra Load 1',         type: 'relay',  channel: 12, priority: 3, mode: 'manual' },
  { id: 'mosfet_1', name: 'LED Strip - Room',     type: 'mosfet', channel: 13, priority: 2, mode: 'manual' },
  { id: 'mosfet_2', name: 'DC Fan Speed Control', type: 'mosfet', channel: 14, priority: 1, mode: 'automatic' },
  { id: 'mosfet_3', name: 'Heater Control',       type: 'mosfet', channel: 15, priority: 3, mode: 'manual' },
  { id: 'mosfet_4', name: 'Extra PWM Load',       type: 'mosfet', channel: 16, priority: 3, mode: 'manual' }
];

// ============================================================
// TELEMETRY SETTINGS
// ============================================================

var TELEMETRY = {
  LOCK_WAIT_MS:        5000,   // ms — lock acquisition timeout
  DEDUP_CACHE_TTL:     30,     // seconds — dedup hash TTL
  MAX_HISTORY_ROWS:     5000,   // max rows returned per query
  DOWNSAMPLE_THRESHOLD: 500     // downsample when results exceed this
};

// ============================================================
// EMAIL TEMPLATE COLORS
// ============================================================

var EMAIL_COLORS = {
  CRITICAL_BG:   '#dc2626',
  WARNING_BG:    '#f59e0b',
  MSG_ID_BG:     '#fef3c7',
  MSG_ID_BORDER: '#f59e0b',
  MSG_EN_BG:     '#e0f2fe',
  MSG_EN_BORDER: '#0ea5e9',
  BODY_BG:       '#f5f5f5',
  CONTAINER_BG:  '#fff',
  HEADER_BG:     '#2d3748',
  DETAILS_BG:    '#f8fafc',
  FOOTER_COLOR:  '#999'
};

// ============================================================
// SYSTEM VERSION
// ============================================================

var SYSTEM_VERSION = '1.5.0';

// ============================================================
// HELPER: Generate unique ID
// ============================================================

// T3-BE-025: Use full UUID for better entropy (128-bit instead of 32-bit substring)
function generateId_(prefix) {
  var uuid = Utilities.getUuid().replace(/-/g, '');
  return prefix ? prefix + '_' + uuid : uuid;
}

// ============================================================
// HELPER: Get ISO timestamp
// ============================================================

var _timezoneCache_ = null;
var _timezoneCacheTime_ = 0;

function getTimezone_() {
  var now = Date.now();
  if (_timezoneCache_ && (now - _timezoneCacheTime_) < 60000) {
    return _timezoneCache_;
  }
  _timezoneCache_ = getConfigValue_('timezone') || 'Asia/Jakarta';
  _timezoneCacheTime_ = now;
  return _timezoneCache_;
}

function getTimestamp_() {
  var tz = getTimezone_();
  return Utilities.formatDate(new Date(), tz, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

// ============================================================
// HELPER: Parse JSON safely
// ============================================================

function safeParse_(str) {
  try {
    return JSON.parse(str);
  } catch (e) {
    return null;
  }
}

// ============================================================
// HELPER: Stringify JSON safely
// ============================================================

function safeStringify_(obj, replacer, space) {
  try {
    return JSON.stringify(obj, replacer || null, space || undefined);
  } catch (e) {
    return '{}';
  }
}

// ============================================================
// HELPER: Sanitize cell value to prevent formula injection
// SECURITY v1.1.0: Prevents CSV/Sheets formula injection attacks
// ============================================================

/**
 * Sanitize a value before writing it to a Google Sheets cell.
 * Prefixes strings starting with formula characters (=, +, -, @, \t)
 * with a single quote (') to force text interpretation in Google Sheets.
 *
 * This prevents formula injection attacks where an attacker could inject
 * malicious formulas (e.g., =CMD(...) in Excel, or =IMPORTXML in Sheets)
 * via user-controlled data fields.
 *
 * @param {*} value - The value to sanitize (any type)
 * @returns {*} Sanitized value (non-strings are returned as-is)
 */
function sanitizeCellValue_(value) {
  if (typeof value !== 'string') return value;
  var str = value;
  // Check if the string starts with a formula character
  if (str.length > 0 && /^[=+\-@\t\r\n\x00]/.test(str)) {
    return "'" + str;
  }
  return str;
}

// ============================================================
// [DEPRECATED] CORS headers helper — REMOVED
// GAS ContentService cannot set custom response headers. This function was
// never functional and has been removed. Do NOT re-add it.
// ============================================================

// ============================================================
// HELPER: Validate device target exists
// ============================================================

/**
 * Check if a device target ID exists in the devices sheet or cache.
 * Used by RuleAPI and ScheduleAPI to validate target device before creation.
 *
 * @param {string} targetDeviceId - Device ID to validate
 * @returns {boolean} True if device exists
 */
function validateDeviceTarget_(targetDeviceId) {
  if (!targetDeviceId) return false;

  // Check cache first
  var cache = CacheService.getScriptCache();
  var cached = cache.get(CACHE.DEVICES_CACHE_KEY);
  if (cached) {
    var result = safeParse_(cached);
    if (result && result.devices) {
      for (var c = 0; c < result.devices.length; c++) {
        if (String(result.devices[c].id) === String(targetDeviceId)) return true;
      }
    }
  }

  // Fallback: read from sheet
  try {
    var ss = getSpreadsheet_();
    var sheet = ss.getSheetByName(SHEET.DEVICES);
    if (!sheet) return false;

    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var colId = headers.indexOf('id');
    if (colId === -1) return false;

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][colId]) === String(targetDeviceId)) return true;
    }
  } catch (e) {
    console.error('validateDeviceTarget_ error: ' + e.message);
  }

  return false;
}

// ============================================================
// HELPER: Build JSON response with CORS
// ============================================================

function jsonResponse_(data, statusCode) {
  // NOTE: GAS ContentService does not support setStatus() or custom HTTP status
  // codes. All responses return HTTP 200. Clients MUST check response.data.code
  // (e.g., 400, 401, 403, 404, 500) to determine the actual result status.
  var code = statusCode || 200;
  return ContentService
    .createTextOutput(safeStringify_(data))
    .setMimeType(ContentService.MimeType.JSON);
}
