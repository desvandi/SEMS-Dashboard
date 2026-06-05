/**
 * @file TelemetryEngine.cpp
 * @brief Telemetry upload engine implementation
 */

#include "TelemetryEngine.h"
#include "../utils/SerialDebugger.h"

// ============================================================================
// CONSTRUCTOR
// ============================================================================

TelemetryEngine::TelemetryEngine()
    : _endpointURL(GAS_TELEMETRY_URL),
      _deviceID(DEVICE_ID),
      _stats({}),
      _initialized(false),
      _retryHead(0),
      _retryTail(0),
      _retryCount(0),
      _lastUploadAttempt(0),
      _uploadInProgress(false) {
    memset(&_stats, 0, sizeof(_stats));
}

// ============================================================================
// INITIALIZATION
// ============================================================================

void TelemetryEngine::begin(const char* endpointURL) {
    if (endpointURL != nullptr && strlen(endpointURL) > 0) {
        _endpointURL = String(endpointURL);
    }

    _initialized = true;
    DBG_TELEMETRY("TelemetryEngine: Initialized (interval=%dms)",
                  TELEMETRY_POST_INTERVAL_MS);
    DBG_TELEMETRY("TelemetryEngine: Endpoint: %s", _endpointURL.c_str());
}

// ============================================================================
// MAIN LOOP
// ============================================================================

void TelemetryEngine::loop(const SensorSystemState& sensorState,
                           const SOC_Calculator& soc,
                           const RelayEngine& relayEngine,
                           bool loadShedActive) {
    if (!_initialized) return;

    unsigned long now = millis();

    // Don't attempt while another upload is in progress
    if (_uploadInProgress) return;

    // -----------------------------------------------------------------------
    // Periodic telemetry upload (every 15 seconds)
    // -----------------------------------------------------------------------
    if (now - _lastUploadAttempt >= TELEMETRY_POST_INTERVAL_MS) {
        // First, try to flush retry queue (oldest entries first)
        if (_retryCount > 0) {
            if (processRetryQueue()) {
                _stats.retries++;
                DBG_TELEMETRY("TelemetryEngine: Retry succeeded");
            }
        }

        // Build and send current telemetry
        String json = buildJSON(sensorState, soc, relayEngine, loadShedActive);
        _lastUploadAttempt = now;

        int httpCode = sendHTTP(json);
        _stats.lastHTTPCode = httpCode;

        if (httpCode == 200 || httpCode == 201) {
            _stats.totalSent++;
            _stats.lastSuccess = true;
            _stats.lastSendTime = now;
            DBG_TELEMETRY("TelemetryEngine: Sent OK (#%lu)", _stats.totalSent);
        } else {
            _stats.totalFailed++;
            _stats.lastSuccess = false;

            // Add to retry queue
            if (addToRetryQueue(json)) {
                DBG_TELEMETRY("TelemetryEngine: Failed (HTTP %d), queued (%u entries)",
                              httpCode, _retryCount);
            } else {
                DBG_TELEMETRY("TelemetryEngine: Failed (HTTP %d), queue FULL",
                              httpCode);
            }
        }
    }
}

// ============================================================================
// FORCE SEND
// ============================================================================

bool TelemetryEngine::forceSend(const SensorSystemState& sensorState,
                                const SOC_Calculator& soc,
                                const RelayEngine& relayEngine,
                                bool loadShedActive) {
    if (!_initialized) return false;
    if (!isWiFiReady()) return false;

    String json = buildJSON(sensorState, soc, relayEngine, loadShedActive);
    int httpCode = sendHTTP(json);
    return (httpCode == 200 || httpCode == 201);
}

// ============================================================================
// JSON PAYLOAD BUILDER
// ============================================================================

String TelemetryEngine::buildJSON(const SensorSystemState& sensorState,
                                  const SOC_Calculator& soc,
                                  const RelayEngine& relayEngine,
                                  bool loadShedActive) {
    // Build JSON manually (ArduinoJson not strictly needed for output)
    String json = "{";

    // Device info
    json += "\"timestamp\":" + String(sensorState.unixTime) + ",";
    json += "\"device_id\":\"" + _deviceID + "\",";

    // Battery data
    json += "\"battery_voltage\":" + String(sensorState.batteryVoltage, 2) + ",";
    json += "\"battery_current\":" + String(sensorState.batteryCurrent, 2) + ",";
    json += "\"battery_power\":" + String(sensorState.batteryPower, 1) + ",";
    json += "\"soc_percent\":" + String(soc.getSOC(), 1) + ",";

    // Cell voltages array
    json += "\"cell_voltages\":[";
    for (int i = 0; i < NUM_CELLS; i++) {
        json += String(sensorState.cellVoltages[i], 2);
        if (i < NUM_CELLS - 1) json += ",";
    }
    json += "],";

    // Inverter current
    json += "\"inverter_current\":" + String(sensorState.inverterCurrent, 2) + ",";
    float inverterPower = sensorState.inverterCurrent * 230.0f;  // AC mains voltage
    json += "\"inverter_power\":" + String(inverterPower, 1) + ",";

    // Environment
    json += "\"room_temp\":" + String(sensorState.roomTemp, 1) + ",";
    json += "\"room_humidity\":" + String(sensorState.roomHumidity, 1) + ",";

    // PIR states
    json += "\"pir_states\":[";
    for (int i = 0; i < PIR_COUNT; i++) {
        json += sensorState.pirStates[i] ? "true" : "false";
        if (i < PIR_COUNT - 1) json += ",";
    }
    json += "],";

    // Relay states
    const RelayState& rs = relayEngine.getState();
    json += "\"relay_states\":[";
    for (int i = 0; i < NUM_RELAYS; i++) {
        json += rs.relays[i] ? "1" : "0";
        if (i < NUM_RELAYS - 1) json += ",";
    }
    json += "],";

    // MOSFET states
    json += "\"mosfet_states\":[";
    for (int i = 0; i < NUM_MOSFETS; i++) {
        json += String(rs.mosfetPWM[i]);
        if (i < NUM_MOSFETS - 1) json += ",";
    }
    json += "],";

    // System info
    json += "\"uptime_seconds\":" + String(sensorState.uptimeSeconds) + ",";
    json += "\"wifi_rssi\":" + String(sensorState.wifiRSSI) + ",";
    json += "\"free_heap\":" + String(sensorState.freeHeap) + ",";
    json += "\"load_shedding_active\":" + String(loadShedActive ? "true" : "false");

    json += "}";
    return json;
}

// ============================================================================
// HTTP POST
// ============================================================================

int TelemetryEngine::sendHTTP(const String& jsonPayload) {
    if (!isWiFiReady()) {
        return -1;  // WiFi not connected
    }

    _uploadInProgress = true;
    HTTPClient http;

    http.setTimeout(HTTP_TIMEOUT_MS);
    http.addHeader("Content-Type", "application/json");

    DBG_TELEMETRY("TelemetryEngine: POST %s (%d bytes)",
                  _endpointURL.c_str(), jsonPayload.length());

    int httpCode = http.POST(jsonPayload);

    if (httpCode > 0) {
        String response = http.getString();
        DBG_TELEMETRY("TelemetryEngine: Response HTTP %d: %s",
                      httpCode, response.substring(0, 200).c_str());
    } else {
        DBG_TELEMETRY("TelemetryEngine: Error: %s", http.errorToString(httpCode).c_str());
    }

    http.end();
    _uploadInProgress = false;
    return httpCode;
}

// ============================================================================
// RETRY QUEUE
// ============================================================================

bool TelemetryEngine::addToRetryQueue(const String& jsonPayload) {
    if (_retryCount >= RETRY_QUEUE_SIZE) {
        // Queue full - drop oldest entry to make room
        _retryTail = (_retryTail + 1) % RETRY_QUEUE_SIZE;
        _retryCount--;
        DBG_TELEMETRY("TelemetryEngine: Queue overflow, dropped oldest entry");
    }

    _retryQueue[_retryHead] = jsonPayload;
    _retryHead = (_retryHead + 1) % RETRY_QUEUE_SIZE;
    _retryCount++;

    _stats.queueSize = _retryCount;
    return true;
}

bool TelemetryEngine::processRetryQueue() {
    if (_retryCount == 0) return false;

    String payload = _retryQueue[_retryTail];
    int httpCode = sendHTTP(payload);

    if (httpCode == 200 || httpCode == 201) {
        // Success - remove from queue
        _retryTail = (_retryTail + 1) % RETRY_QUEUE_SIZE;
        _retryCount--;
        _stats.queueSize = _retryCount;
        return true;
    }

    // Still failed - leave in queue, will retry next cycle
    return false;
}

// ============================================================================
// UTILITY
// ============================================================================

bool TelemetryEngine::isWiFiReady() const {
    return (WiFi.status() == WL_CONNECTED);
}

void TelemetryEngine::setEndpoint(const char* url) {
    if (url != nullptr) _endpointURL = String(url);
}

void TelemetryEngine::setDeviceID(const char* id) {
    if (id != nullptr) _deviceID = String(id);
}

const TelemetryStats& TelemetryEngine::getStats() const {
    return _stats;
}
