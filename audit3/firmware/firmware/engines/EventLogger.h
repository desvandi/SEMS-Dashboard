/**
 * @file EventLogger.h
 * @brief Local event caching with cloud synchronization
 *
 * Logs system events locally in a circular buffer and syncs to the
 * cloud endpoint periodically. Events include:
 *   - Safety alerts (brownout, overvoltage, etc.)
 *   - Load shedding events
 *   - Relay state changes
 *   - System events (boot, WiFi connect, OTA)
 *   - Automation triggers
 *   - Schedule executions
 *
 * Features:
 *   - 100-event local circular buffer
 *   - Cloud sync in batches of 10
 *   - Event severity levels (INFO, WARNING, ERROR, CRITICAL)
 *   - Timestamp from RTC
 *   - Category tagging for filtering
 */

#ifndef SEMS_EVENT_LOGGER_H
#define SEMS_EVENT_LOGGER_H

#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include "config.h"

/**
 * @struct LogEvent
 * @brief A single log event entry.
 */
struct LogEvent {
    uint32_t timestamp;       // Unix timestamp from RTC
    unsigned long millisTs;   // millis() timestamp
    uint8_t level;            // Severity level (0=INFO, 1=WARN, 2=ERR, 3=CRIT)
    char category[16];        // Event category (e.g., "SAFETY", "RELAY", "SYSTEM")
    char message[80];         // Event message
    bool synced;              // true if synced to cloud
};

/**
 * @struct EventLoggerStats
 * @brief Statistics about the event logger.
 */
struct EventLoggerStats {
    uint32_t totalEvents;       // Total events logged since boot
    uint32_t eventsSynced;      // Total events synced to cloud
    uint32_t pendingSync;       // Events pending cloud sync
    uint32_t bufferOverflows;   // Times buffer overflowed (oldest dropped)
    uint32_t syncFailures;      // Cloud sync failures
    unsigned long lastSyncTime; // millis() of last successful sync
};

/**
 * @class EventLogger
 * @brief Local event cache with cloud synchronization.
 */
class EventLogger {
public:
    EventLogger();

    /**
     * @brief Initialize the event logger.
     * @param endpointURL GAS endpoint URL for event logging.
     */
    void begin(const char* endpointURL = GAS_TELEMETRY_URL);

    /**
     * @brief Main loop - handles periodic cloud sync.
     */
    void loop();

    /**
     * @brief Log an info-level event.
     * @param category Event category.
     * @param format printf-style message format.
     */
    template<typename... Args>
    void info(const char* category, const char* format, Args... args);

    /**
     * @brief Log a warning-level event.
     */
    template<typename... Args>
    void warning(const char* category, const char* format, Args... args);

    /**
     * @brief Log an error-level event.
     */
    template<typename... Args>
    void error(const char* category, const char* format, Args... args);

    /**
     * @brief Log a critical-level event.
     */
    template<typename... Args>
    void critical(const char* category, const char* format, Args... args);

    /**
     * @brief Get logger statistics.
     * @return Const reference to EventLoggerStats.
     */
    const EventLoggerStats& getStats() const;

    /**
     * @brief Set the device ID for event logging.
     * @param id Device identifier.
     */
    void setDeviceID(const char* id);

    /**
     * @brief Set RTC timestamp for events (call before logging).
     * @param unixTime Current Unix timestamp.
     */
    void setTimestamp(uint32_t unixTime);

    /**
     * @brief Get the number of events pending sync.
     * @return Count of unsynced events.
     */
    uint16_t getPendingCount() const;

private:
    LogEvent _buffer[EVENT_LOG_MAX]; // Circular event buffer
    uint16_t _head;                  // Next write position
    uint16_t _count;                 // Current entries (up to EVENT_LOG_MAX)
    EventLoggerStats _stats;
    String _endpointURL;
    String _deviceID;
    bool _initialized;
    uint32_t _currentUnixTime;       // Current RTC timestamp

    // Timing
    unsigned long _lastSyncAttempt;

    // Incremental pending counter (avoids O(n) buffer scan on every logEvent)
    uint16_t _pendingSyncCount;

    // Pre-allocated sync index buffer (avoids stack allocation per sync call)
    uint16_t _toSync[EVENT_LOG_MAX];

    /**
     * @brief Core logging function.
     */
    void logEvent(uint8_t level, const char* category, const char* message);

    /**
     * @brief Sync pending events to cloud.
     * @return true if all pending events were synced.
     */
    bool syncToCloud();
};

// ============================================================================
// TEMPLATE IMPLEMENTATIONS (must be in header)
// ============================================================================

template<typename... Args>
void EventLogger::info(const char* category, const char* format, Args... args) {
    char buf[80];
    snprintf(buf, sizeof(buf), format, args...);
    logEvent(EVENT_LEVEL_INFO, category, buf);
}

template<typename... Args>
void EventLogger::warning(const char* category, const char* format, Args... args) {
    char buf[80];
    snprintf(buf, sizeof(buf), format, args...);
    logEvent(EVENT_LEVEL_WARNING, category, buf);
}

template<typename... Args>
void EventLogger::error(const char* category, const char* format, Args... args) {
    char buf[80];
    snprintf(buf, sizeof(buf), format, args...);
    logEvent(EVENT_LEVEL_ERROR, category, buf);
}

template<typename... Args>
void EventLogger::critical(const char* category, const char* format, Args... args) {
    char buf[80];
    snprintf(buf, sizeof(buf), format, args...);
    logEvent(EVENT_LEVEL_CRITICAL, category, buf);
}

#endif // SEMS_EVENT_LOGGER_H
