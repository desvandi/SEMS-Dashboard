/**
 * @file ConfigSyncEngine.cpp
 * @brief Configuration sync engine implementation
 *
 * TODO: The extractFloat/extractBool/extractString JSON parsing helpers in this
 * file duplicate similar functions in AutomationEngine.cpp (extractJStr).
 * These should be extracted to a shared utility (e.g., utils/JsonParser.h).
 */

#include "ConfigSyncEngine.h"
#include "../utils/SerialDebugger.h"

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
    String searchKey = String("\"") + key + "\":");
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

    // Parse load shedding thresholds
    float v = extractFloat(json, "shed_soc_critical");
    if (!isnan(v)) _config.shedSOCCritical = v;

    v = extractFloat(json, "shed_soc_low");
    if (!isnan(v)) _config.shedSOCLow = v;

    v = extractFloat(json, "shed_soc_normal");
    if (!isnan(v)) _config.shedSOCNormal = v;

    v = extractFloat(json, "shed_restore_hysteresis");
    if (!isnan(v)) _config.shedRestoreHysteresis = v;

    // Parse safety thresholds
    v = extractFloat(json, "safety_brownout_v");
    if (!isnan(v)) _config.safetyBrownoutV = v;

    v = extractFloat(json, "safety_overvoltage_v");
    if (!isnan(v)) _config.safetyOvervoltageV = v;

    v = extractFloat(json, "safety_overcurrent_a");
    if (!isnan(v)) _config.safetyOvercurrentA = v;

    v = extractFloat(json, "safety_overtemp_c");
    if (!isnan(v)) _config.safetyOvertempC = v;

    v = extractFloat(json, "safety_cell_diff_max_v");
    if (!isnan(v)) _config.safetyCellDiffMaxV = v;

    // Parse telemetry interval
    v = extractFloat(json, "telemetry_interval_ms");
    if (!isnan(v) && v >= 5000) _config.telemetryIntervalMs = (unsigned long)v;

    // Parse device info
    String s = extractString(json, "device_name");
    if (s.length() > 0) _config.deviceName = s;

    s = extractString(json, "location_name");
    if (s.length() > 0) _config.locationName = s;

    _config.receivedTimestamp = millis();

    DBG_ENGINE("ConfigSync: Parsed config - ShedCritical=%.1f%%, Brownout=%.1fV",
               _config.shedSOCCritical, _config.safetyBrownoutV);

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
