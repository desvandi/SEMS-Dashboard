/**
 * @file EventLogger.cpp
 * @brief Event logger implementation
 */

#include "EventLogger.h"
#include "../utils/SerialDebugger.h"

// ============================================================================
// CONSTRUCTOR
// ============================================================================

EventLogger::EventLogger()
    : _head(0),
      _count(0),
      _stats({}),
      _endpointURL(GAS_TELEMETRY_URL),
      _deviceID(DEVICE_ID),
      _initialized(false),
      _currentUnixTime(0),
      _lastSyncAttempt(0),
      _pendingSyncCount(0) {
    memset(_buffer, 0, sizeof(_buffer));
}

// ============================================================================
// INITIALIZATION
// ============================================================================

void EventLogger::begin(const char* endpointURL) {
    if (endpointURL != nullptr && strlen(endpointURL) > 0) {
        _endpointURL = String(endpointURL);
    }

    _initialized = true;
    DBG_EVENT("EventLogger: Initialized (buffer=%d, sync_interval=%dms)",
              EVENT_LOG_MAX, EVENT_SYNC_INTERVAL_MS);
}

// ============================================================================
// MAIN LOOP
// ============================================================================

void EventLogger::loop() {
    if (!_initialized) return;

    unsigned long now = millis();

    // Periodic cloud sync (every 5 seconds)
    if (now - _lastSyncAttempt >= EVENT_SYNC_INTERVAL_MS) {
        _lastSyncAttempt = now;

        if (_stats.pendingSync > 0 && WiFi.status() == WL_CONNECTED) {
            syncToCloud();
        }
    }
}

// ============================================================================
// CORE LOGGING
// ============================================================================

void EventLogger::logEvent(uint8_t level, const char* category, const char* message) {
    if (!_initialized) return;

    // Write to circular buffer
    LogEvent& entry = _buffer[_head];
    entry.timestamp = _currentUnixTime;
    entry.millisTs = millis();
    entry.level = level;
    entry.synced = false;

    // Copy category (truncate if needed)
    strncpy(entry.category, category, sizeof(entry.category) - 1);
    entry.category[sizeof(entry.category) - 1] = '\0';

    // Copy message (truncate if needed)
    strncpy(entry.message, message, sizeof(entry.message) - 1);
    entry.message[sizeof(entry.message) - 1] = '\0';

    // Advance head pointer
    _head = (_head + 1) % EVENT_LOG_MAX;

    if (_count < EVENT_LOG_MAX) {
        _count++;
    } else {
        // Buffer overflow - oldest event dropped
        _stats.bufferOverflows++;
    }

    _stats.totalEvents++;
    _pendingSyncCount++;
    _stats.pendingSync = _pendingSyncCount;

    // Log to serial as well
    const char* levelStr[] = {"INFO", "WARN", " ERR", "CRIT"};
    if (level < 4) {
        DBG_EVENT("[%s] %s: %s", levelStr[level], category, message);
    }
}

// ============================================================================
// CLOUD SYNC
// ============================================================================

bool EventLogger::syncToCloud() {
    // Find unsynced events (using class member _toSync to avoid stack allocation)
    uint16_t syncCount = 0;

    for (uint16_t i = 0; i < _count; i++) {
        uint16_t idx = (_head - _count + i + EVENT_LOG_MAX) % EVENT_LOG_MAX;
        if (!_buffer[idx].synced) {
            if (syncCount < EVENT_CLOUD_BATCH) {
                _toSync[syncCount] = idx;
                syncCount++;
            }
        }
    }

    if (syncCount == 0) return true;

    // Build JSON payload
    String json = "[";
    for (uint16_t i = 0; i < syncCount; i++) {
        const LogEvent& e = _buffer[_toSync[i]];

        if (i > 0) json += ",";

        json += "{";
        json += "\"device_id\":\"" + _deviceID + "\",";
        json += "\"timestamp\":" + String(e.timestamp) + ",";
        json += "\"level\":" + String(e.level) + ",";
        json += "\"category\":\"" + String(e.category) + "\",";
        json += "\"message\":\"" + String(e.message) + "\"";
        json += "}";
    }
    json += "]";

    // Send HTTP POST
    HTTPClient http;
    http.setTimeout(HTTP_TIMEOUT_MS);

    String url = _endpointURL + "?type=event";
    http.begin(url);
    http.addHeader("Content-Type", "application/json");

    int httpCode = http.POST(json);
    http.end();

    if (httpCode == 200 || httpCode == 201) {
        // Mark events as synced
        for (uint16_t i = 0; i < syncCount; i++) {
            _buffer[_toSync[i]].synced = true;
            _stats.eventsSynced++;
        }

        _pendingSyncCount -= syncCount;
        _stats.pendingSync = _pendingSyncCount;
        _stats.lastSyncTime = millis();

        DBG_EVENT("Synced %d events to cloud (HTTP %d)", syncCount, httpCode);
        return true;
    }

    _stats.syncFailures++;
    DBG_EVENT("Cloud sync failed (HTTP %d)", httpCode);
    return false;
}

// ============================================================================
// GETTERS
// ============================================================================

const EventLoggerStats& EventLogger::getStats() const {
    return _stats;
}

void EventLogger::setDeviceID(const char* id) {
    if (id != nullptr) _deviceID = String(id);
}

void EventLogger::setTimestamp(uint32_t unixTime) {
    _currentUnixTime = unixTime;
}

uint16_t EventLogger::getPendingCount() const {
    return _stats.pendingSync;
}
