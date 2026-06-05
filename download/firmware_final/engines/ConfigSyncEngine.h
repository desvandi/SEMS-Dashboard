/**
 * @file ConfigSyncEngine.h
 * @brief Periodic configuration synchronization from GAS
 *
 * Fetches updated configuration from Google Apps Script every 60 seconds.
 * Configuration includes:
 *   - Relay default states
 *   - Automation rules (JSON)
 *   - Schedule events
 *   - Load shedding thresholds
 *   - Safety thresholds (adjustable)
 *   - Device settings (calibration offsets, intervals)
 *
 * Uses HTTP GET with query parameter for device identification.
 * Response format: JSON object with configuration key-value pairs.
 */

#ifndef SEMS_CONFIG_SYNC_ENGINE_H
#define SEMS_CONFIG_SYNC_ENGINE_H

#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include "config.h"

/**
 * @struct RemoteConfig
 * @brief Configuration received from the remote server.
 */
struct RemoteConfig {
    // Relay defaults
    bool relayDefaults[NUM_RELAYS];

    // Load shedding thresholds
    float shedSOCCritical;
    float shedSOCLow;
    float shedSOCNormal;
    float shedRestoreHysteresis;

    // Safety thresholds
    float safetyBrownoutV;
    float safetyOvervoltageV;
    float safetyOvercurrentA;
    float safetyOvertempC;
    float safetyCellDiffMaxV;

    // Telemetry settings
    unsigned long telemetryIntervalMs;

    // Device settings
    String deviceName;
    String locationName;

    // Flags
    bool configReceived;
    bool configValid;
    unsigned long receivedTimestamp;
};

/**
 * @class ConfigSyncEngine
 * @brief Fetches and applies remote configuration periodically.
 */
class ConfigSyncEngine {
public:
    ConfigSyncEngine();

    /**
     * @brief Initialize the config sync engine.
     * @param configURL GAS configuration endpoint URL.
     */
    void begin(const char* configURL = GAS_CONFIG_URL);

    /**
     * @brief Main loop - handles periodic config fetch.
     */
    void loop();

    /**
     * @brief Get the current remote configuration.
     * @return Const reference to RemoteConfig.
     */
    const RemoteConfig& getConfig() const;

    /**
     * @brief Check if a valid config has been received.
     * @return true if config was received and parsed successfully.
     */
    bool hasConfig() const;

    /**
     * @brief Force an immediate config fetch.
     * @return true if fetch and parse succeeded.
     */
    bool forceSync();

    /**
     * @brief Set the device ID for config requests.
     * @param id Device identifier string.
     */
    void setDeviceID(const char* id);

    /**
     * @brief Set the config endpoint URL.
     * @param url New endpoint URL.
     */
    void setEndpoint(const char* url);

    /**
     * @brief Get time since last successful config sync.
     * @return Milliseconds since last successful sync.
     */
    unsigned long timeSinceLastSync() const;

private:
    String _configURL;         // GAS config endpoint URL
    String _deviceID;          // Device identifier
    RemoteConfig _config;      // Current remote configuration
    bool _initialized;

    // Timing
    unsigned long _lastSyncAttempt;
    unsigned long _lastSuccessSync;

    /**
     * @brief Fetch configuration JSON from GAS endpoint.
     * @return HTTP response body, or empty string on failure.
     */
    String fetchConfig();

    /**
     * @brief Parse JSON configuration response.
     * @param json JSON string from server.
     * @return true if parsed successfully.
     */
    bool parseConfig(const String& json);

    /**
     * @brief Check if WiFi is ready for HTTP request.
     * @return true if WiFi is connected.
     */
    bool isWiFiReady() const;
};

#endif // SEMS_CONFIG_SYNC_ENGINE_H
