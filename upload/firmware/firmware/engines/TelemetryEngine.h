/**
 * @file TelemetryEngine.h
 * @brief HTTP telemetry upload engine with retry queue
 *
 * Posts sensor data to Google Apps Script (GAS) endpoint every 15 seconds.
 * Features:
 *   - JSON payload construction from SensorSystemState
 *   - Circular retry buffer (50 entries) for failed uploads
 *   - Automatic retry of failed transmissions
 *   - WiFi connectivity checks before upload attempts
 *   - Configurable GAS endpoint URL
 */

#ifndef SEMS_TELEMETRY_ENGINE_H
#define SEMS_TELEMETRY_ENGINE_H

#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include "../sensors/SensorEngine.h"
#include "../utils/SOC_Calculator.h"
#include "../engines/RelayEngine.h"
#include "config.h"

/**
 * @struct TelemetryStats
 * @brief Statistics about telemetry transmission.
 */
struct TelemetryStats {
    uint32_t totalSent;          // Total successful transmissions
    uint32_t totalFailed;        // Total failed transmissions
    uint32_t retries;            // Total retry attempts
    uint32_t queueSize;          // Current retry queue size
    uint32_t lastSendTime;       // millis() of last successful send
    uint32_t lastAttemptTime;    // millis() of last attempt
    bool lastSuccess;            // true if last attempt succeeded
    int lastHTTPCode;            // Last HTTP response code
};

/**
 * @class TelemetryEngine
 * @brief Manages telemetry data upload to cloud via HTTP POST.
 */
class TelemetryEngine {
public:
    TelemetryEngine();

    /**
     * @brief Initialize the telemetry engine.
     * @param endpointURL GAS endpoint URL for telemetry posting.
     */
    void begin(const char* endpointURL = GAS_TELEMETRY_URL);

    /**
     * @brief Main loop - handles periodic upload and retries.
     * @param sensorState Current sensor system state.
     * @param soc SOC calculator reference.
     * @param relayEngine Relay engine reference (for relay state telemetry).
     */
    void loop(const SensorSystemState& sensorState,
              const SOC_Calculator& soc,
              const RelayEngine& relayEngine,
              bool loadShedActive = false);

    /**
     * @brief Set the GAS endpoint URL.
     * @param url New endpoint URL.
     */
    void setEndpoint(const char* url);

    /**
     * @brief Set the device ID for telemetry.
     * @param id Device identifier string.
     */
    void setDeviceID(const char* id);

    /**
     * @brief Get telemetry statistics.
     * @return Const reference to TelemetryStats.
     */
    const TelemetryStats& getStats() const;

    /**
     * @brief Force an immediate telemetry upload.
     * @param sensorState Current sensor system state.
     * @param soc SOC calculator reference.
     * @param relayEngine Relay engine reference.
     * @param loadShedActive Whether load shedding is active.
     * @return true if upload succeeded.
     */
    bool forceSend(const SensorSystemState& sensorState,
                   const SOC_Calculator& soc,
                   const RelayEngine& relayEngine,
                   bool loadShedActive = false);

private:
    String _endpointURL;         // GAS endpoint URL
    String _deviceID;            // Device identifier
    TelemetryStats _stats;       // Transmission statistics
    bool _initialized;

    // Retry queue (circular buffer)
    String _retryQueue[RETRY_QUEUE_SIZE];
    uint16_t _retryHead;         // Next slot to write
    uint16_t _retryTail;         // Next slot to read
    uint16_t _retryCount;        // Current entries in queue

    // Timing
    unsigned long _lastUploadAttempt;
    bool _uploadInProgress;

    /**
     * @brief Build JSON payload from current sensor state.
     * @param sensorState Sensor data.
     * @param soc SOC data.
     * @param relayEngine Relay states.
     * @param loadShedActive Load shedding state.
     * @return JSON string.
     */
    String buildJSON(const SensorSystemState& sensorState,
                     const SOC_Calculator& soc,
                     const RelayEngine& relayEngine,
                     bool loadShedActive);

    /**
     * @brief Send a JSON payload via HTTP POST.
     * @param jsonPayload JSON string to send.
     * @return HTTP status code (200 = success).
     */
    int sendHTTP(const String& jsonPayload);

    /**
     * @brief Add a failed payload to the retry queue.
     * @param jsonPayload JSON string to retry.
     * @return true if added to queue (false = queue full).
     */
    bool addToRetryQueue(const String& jsonPayload);

    /**
     * @brief Attempt to send the oldest entry from retry queue.
     * @return true if retry succeeded (entry removed from queue).
     */
    bool processRetryQueue();

    /**
     * @brief Check if WiFi is connected and ready for HTTP.
     * @return true if WiFi is connected.
     */
    bool isWiFiReady() const;
};

#endif // SEMS_TELEMETRY_ENGINE_H
