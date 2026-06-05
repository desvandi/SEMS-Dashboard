/**
 * @file ConfigSyncEngine.cpp
 * @brief Configuration sync engine implementation
 *
 * TODO: The extractFloat/extractBool/extractString JSON parsing helpers in this
 * file duplicate similar functions in AutomationEngine.cpp (extractJStr).
 * These should be extracted to a shared utility (e.g., utils/JsonParser.h).
 *
 * FIX v1.0.2: Added bounds checking for all safety-related config values.
 *   Remote values are clamped to safe physical limits defined in config.h.
 */

#include "ConfigSyncEngine.h"
#include "../utils/SerialDebugger.h"

// ============================================================================
// HELPER: Clamp a float value to a safe range
// ============================================================================

static float clampSafe(float value, float minVal, float maxVal) {
    if (isnan(value)) return minVal;  // Default to min on invalid input
    if (value < minVal) return minVal;
    if (value > maxVal) return maxVal;
    return value;
}

// ============================================================================
// CONSTRUCTOR
// ============================================================================

ConfigSyncEngine::ConfigSyncEngine()
    : _configURL(GAS_CONFIG_URL),
      _deviceID(DEVICE_ID),
      _config({}),
      _initialized(false),
      _lastSyncAttempt(0),
      _lastSuccessSync(0) {
    memset(&_config, 0, sizeof(_config));
    _config.configReceived = false;
    _config.configValid = false;

    // Set defaults from config.h
    _config.shedSOCCritical = SHED_SOC_CRITICAL;
    _config.shedSOCLow = SHED_SOC_LOW;
    _config.shedSOCNormal = SHED_SOC_NORMAL;
    _config.shedRestoreHysteresis = SHED_RESTORE_HYSTERESIS;
    _config.safetyBrownoutV = SAFETY_BROWNOUT_V;
    _config.safetyOvervoltageV = SAFETY_OVERVOLTAGE_V;
    _config.safetyOvercurrentA = SAFETY_OVERCURRENT_A;
    _config.safetyOvertempC = SAFETY_OVERTEMP_C;
    _config.safetyCellDiffMaxV = SAFETY_CELL_DIFF_MAX_V;
    _config.telemetryIntervalMs = TELEMETRY_POST_INTERVAL_MS;
}

// ============================================================================
// INITIALIZATION
// ============================================================================

void ConfigSyncEngine::begin(const char* configURL) {
    if (configURL != nullptr && strlen(configURL) > 0) {
        _configURL = String(configURL);
    }

    _initialized = true;
    DBG_ENGINE("ConfigSync: Initialized (interval=%dms)", CONFIG_SYNC_INTERVAL_MS);
    DBG_ENGINE("ConfigSync: Endpoint: %s", _configURL.c_str());
}

// ============================================================================
// MAIN LOOP
// ============================================================================

void ConfigSyncEngine::loop() {
    if (!_initialized) return;

    unsigned long now = millis();

    // Periodic config sync (every 60 seconds)
    if (now - _lastSyncAttempt >= CONFIG_SYNC_INTERVAL_MS) {
        _lastSyncAttempt = now;
        forceSync();
    }
}

// ============================================================================
// FORCE SYNC
// ============================================================================

bool ConfigSyncEngine::forceSync() {
    if (!_initialized || !isWiFiReady()) return false;

    DBG_ENGINE("ConfigSync: Fetching remote configuration...");

    String json = fetchConfig();

    if (json.length() > 0) {
        if (parseConfig(json)) {
            _lastSuccessSync = millis();
            _config.configReceived = true;
            _config.configValid = true;
            DBG_ENGINE("ConfigSync: Configuration updated successfully");
            return true;
        } else {
            DBG_ENGINE("ConfigSync: Failed to parse configuration");
            return false;
        }
    }

    DBG_ENGINE("ConfigSync: Failed to fetch configuration");
    return false;
}

// ============================================================================
// HTTP FETCH
// ============================================================================

String ConfigSyncEngine::fetchConfig() {
    if (!isWiFiReady()) return "";

    HTTPClient http;
    http.setTimeout(HTTP_TIMEOUT_MS);

    // Build URL with device ID parameter
    String url = _configURL + "?device_id=" + _deviceID;
    http.begin(url);
    http.addHeader("Content-Type", "application/json");

    int httpCode = http.GET();

    String response = "";
    if (httpCode == 200) {
        response = http.getString();
        DBG_ENGINE("ConfigSync: Received %d bytes", response.length());
    } else {
        DBG_ENGINE("ConfigSync: HTTP error %d", httpCode);
    }

    http.end();
    return response;
}

// ============================================================================
// JSON PARSING (Simple manual parsing - avoids ArduinoJson dependency)
// ============================================================================

/**
 * @brief Extract a float value from a JSON string by key.
 * Simple parser for flat JSON objects. Not a full JSON parser.
 */
static float extractFloat(const String& json, const char* key) {
    String searchKey = String("\"") + key + "\":";
    int keyPos = json.indexOf(searchKey);
    if (keyPos < 0) return NAN;

    int valueStart = keyPos + searchKey.length();
    // Skip whitespace
    while (valueStart < (int)json.length() && json[valueStart] == ' ') valueStart++;

    String valueStr;
    while (valueStart < (int)json.length()) {
        char c = json[valueStart];
        if (c == ',' || c == '}' || c == '\n' || c == '\r') break;
        valueStr += c;
        valueStart++;
    }

    valueStr.trim();
    return valueStr.toFloat();
}

/**
 * @brief Extract a boolean value from a JSON string by key.
 */
static bool extractBool(const String& json, const char* key) {
    String searchKey = String("\"") + key + "\":";
    int keyPos = json.indexOf(searchKey);
    if (keyPos < 0) return false;

    int valueStart = keyPos + searchKey.length();
    while (valueStart < (int)json.length() && json[valueStart] == ' ') valueStart++;

    if (json.substring(valueStart, valueStart + 4) == "true") return true;
    return false;
}

/**
 * @brief Extract a string value from a JSON string by key.
 */
static String extractString(const String& json, const char* key) {
    // P2-017: Fixed typo — removed stray ")" from search key
    String searchKey = String("\"") + key + "\":";
    int keyPos = json.indexOf(searchKey);
    if (keyPos < 0) return "";

    int valueStart = keyPos + searchKey.length();
    while (valueStart < (int)json.length() && json[valueStart] == ' ') valueStart++;

    if (json[valueStart] != '"') return "";

    valueStart++;  // Skip opening quote
    String result;
    while (valueStart < (int)json.length()) {
        char c = json[valueStart];
        if (c == '"') break;
        if (c == '\\' && valueStart + 1 < (int)json.length()) {
            valueStart++;
            result += json[valueStart];
        } else {
            result += c;
        }
        valueStart++;
    }

    return result;
}

bool ConfigSyncEngine::parseConfig(const String& json) {
    if (json.length() < 10) return false;  // Too short to be valid

    // FIX v1.0.2: Validate response size to prevent memory exhaustion
    if (json.length() > 8192) {
        DBG_ENGINE("ConfigSync: Response too large (%d bytes), rejected", json.length());
        return false;
    }

    // Parse load shedding thresholds
    float v = extractFloat(json, "shed_soc_critical");
    if (!isnan(v)) _config.shedSOCCritical = clampSafe(v, 5.0, 50.0);

    v = extractFloat(json, "shed_soc_low");
    if (!isnan(v)) _config.shedSOCLow = clampSafe(v, 5.0, 50.0);

    v = extractFloat(json, "shed_soc_normal");
    if (!isnan(v)) _config.shedSOCNormal = clampSafe(v, 10.0, 80.0);

    v = extractFloat(json, "shed_restore_hysteresis");
    if (!isnan(v)) _config.shedRestoreHysteresis = clampSafe(v, 1.0, 20.0);

    // FIX v1.0.2: Parse safety thresholds with bounds checking
    v = extractFloat(json, "safety_brownout_v");
    if (!isnan(v)) _config.safetyBrownoutV = clampSafe(v, 2.0, 5.0);

    v = extractFloat(json, "safety_overvoltage_v");
    if (!isnan(v)) _config.safetyOvervoltageV = clampSafe(v, SAFETY_VALID_OVERVOLT_MIN, SAFETY_VALID_OVERVOLT_MAX);

    v = extractFloat(json, "safety_overcurrent_a");
    if (!isnan(v)) _config.safetyOvercurrentA = clampSafe(v, SAFETY_VALID_OVERCURRENT_MIN, SAFETY_VALID_OVERCURRENT_MAX);

    v = extractFloat(json, "safety_overtemp_c");
    if (!isnan(v)) _config.safetyOvertempC = clampSafe(v, SAFETY_VALID_OVERTEMP_MIN, SAFETY_VALID_OVERTEMP_MAX);

    v = extractFloat(json, "safety_cell_diff_max_v");
    if (!isnan(v)) _config.safetyCellDiffMaxV = clampSafe(v, SAFETY_VALID_CELL_IMBAL_MIN, SAFETY_VALID_CELL_IMBAL_MAX);

    // Parse telemetry interval with bounds checking
    v = extractFloat(json, "telemetry_interval_ms");
    if (!isnan(v) && v >= SAFETY_VALID_TELEM_MIN_MS && v <= SAFETY_VALID_TELEM_MAX_MS) {
        _config.telemetryIntervalMs = (unsigned long)v;
    }

    // Parse device info
    String s = extractString(json, "device_name");
    if (s.length() > 0 && s.length() < 64) _config.deviceName = s;

    s = extractString(json, "location_name");
    if (s.length() > 0 && s.length() < 64) _config.locationName = s;

    // P2-013: Cross-validation: overvoltage must be >= undervoltage + 4.0V
    // This ensures a logical gap between protection thresholds
    if (_config.safetyOvervoltageV > 0 && _config.safetyBrownoutV > 0) {
        if (_config.safetyOvervoltageV < _config.safetyBrownoutV + 4.0f) {
            DBG_ENGINE("ConfigSync: Cross-validation FAIL — overvoltage %.1fV < undervoltage %.1fV + 4V. Rejecting thresholds.",
                       _config.safetyOvervoltageV, _config.safetyBrownoutV);
            _config.safetyOvervoltageV = _config.safetyBrownoutV + 4.0f;
            DBG_ENGINE("ConfigSync: Overvoltage adjusted to %.1fV", _config.safetyOvervoltageV);
        }
    }

    _config.receivedTimestamp = millis();

    DBG_ENGINE("ConfigSync: Parsed config - ShedCritical=%.1f%%, Brownout=%.1fV, OC=%.1fA, OT=%.1fC",
               _config.shedSOCCritical, _config.safetyBrownoutV,
               _config.safetyOvercurrentA, _config.safetyOvertempC);

    // P2-015: Bridge remote config values to .ino safety engine via volatile globals
    // These are defined as 'extern volatile' in the .ino file
    extern volatile float remoteSafetyOvervolt;
    extern volatile float remoteSafetyUndervolt;
    extern volatile float remoteSafetyOvercurrent;
    extern volatile float remoteSafetyOvertemp;
    extern volatile float remoteSafetyCellImbalance;
    extern volatile bool remoteConfigValid;

    remoteSafetyOvervolt = _config.safetyOvervoltageV;
    remoteSafetyUndervolt = _config.safetyBrownoutV;
    remoteSafetyOvercurrent = _config.safetyOvercurrentA;
    remoteSafetyOvertemp = _config.safetyOvertempC;
    remoteSafetyCellImbalance = _config.safetyCellDiffMaxV;
    remoteConfigValid = true;
    DBG_ENGINE("ConfigSync: Safety thresholds bridged to volatile globals");

    return true;
}

// ============================================================================
// GETTERS
// ============================================================================

const RemoteConfig& ConfigSyncEngine::getConfig() const {
    return _config;
}

bool ConfigSyncEngine::hasConfig() const {
    return _config.configReceived && _config.configValid;
}

void ConfigSyncEngine::setDeviceID(const char* id) {
    if (id != nullptr) _deviceID = String(id);
}

void ConfigSyncEngine::setEndpoint(const char* url) {
    if (url != nullptr) _configURL = String(url);
}

unsigned long ConfigSyncEngine::timeSinceLastSync() const {
    return millis() - _lastSuccessSync;
}

bool ConfigSyncEngine::isWiFiReady() const {
    return (WiFi.status() == WL_CONNECTED);
}
