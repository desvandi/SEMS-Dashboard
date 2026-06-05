/**
 * @file SafetyEngine.h
 * @brief Safety monitoring and protection engine
 *
 * Monitors critical system parameters and triggers protective actions:
 *
 *   1. Brownout Detection: Battery < 21.0V → Emergency load reduction
 *   2. Overvoltage Protection: Battery > 29.6V → Disconnect charge source
 *   3. Overcurrent Protection: Current > 50A → Warning/alarm
 *   4. Over-temperature: Room temp > 60°C → Warning
 *   5. Cell Imbalance: Max cell diff > 0.15V → Warning
 *   6. Cell Undervoltage: Any cell < 2.0V → Critical alarm
 *   7. Sensor Timeout: No sensor update > 30s → Warning
 *
 * Safety actions are prioritized and can trigger relay shutdowns.
 */

#ifndef SEMS_SAFETY_ENGINE_H
#define SEMS_SAFETY_ENGINE_H

#include <Arduino.h>
#include "../sensors/SensorEngine.h"
#include "config.h"

/**
 * @enum SafetyEvent
 * @brief Types of safety events that can be triggered.
 */
enum SafetyEvent {
    SAFETY_NONE = 0,
    SAFETY_BROWNOUT,
    SAFETY_OVERVOLTAGE,
    SAFETY_OVERCURRENT,
    SAFETY_OVERTEMP,
    SAFETY_CELL_IMBALANCE,
    SAFETY_CELL_UNDERVOLTAGE,
    SAFETY_CELL_OVERVOLTAGE,
    SAFETY_SENSOR_TIMEOUT
};

/**
 * @struct SafetyStatus
 * @brief Current safety monitoring state.
 */
struct SafetyStatus {
    bool brownout;                  // Brownout condition active
    bool overvoltage;               // Overvoltage condition active
    bool overcurrent;               // Overcurrent condition active
    bool overtemp;                  // Over-temperature condition active
    bool cellImbalance;             // Cell imbalance condition active
    bool cellUndervoltage;          // Cell undervoltage active
    bool cellOvervoltage;           // Cell overvoltage active
    bool sensorTimeout;             // Sensor timeout active
    SafetyEvent activeEvent;        // Most recent active safety event
    SafetyEvent lastEvent;          // Last safety event (even if cleared)
    int activeAlerts;               // Count of currently active alerts
    unsigned long lastCheck;        // millis() of last safety check
    unsigned long eventStart;       // millis() when current event started
    bool emergencyShutdown;         // true if emergency shutdown is active
};

/**
 * @class SafetyEngine
 * @brief Monitors safety conditions and triggers protective actions.
 */
class SafetyEngine {
public:
    SafetyEngine();

    /**
     * @brief Initialize the safety engine.
     */
    void begin();

    /**
     * @brief Main loop - check all safety conditions.
     * @param sensorState Current sensor system state.
     */
    void loop(const SensorSystemState& sensorState);

    /**
     * @brief Get the current safety status.
     * @return Const reference to SafetyStatus.
     */
    const SafetyStatus& getStatus() const;

    /**
     * @brief Check if any safety alert is active.
     * @return true if at least one alert is active.
     */
    bool hasAlert() const;

    /**
     * @brief Check if emergency shutdown is active.
     * @return true if emergency shutdown has been triggered.
     */
    bool isEmergencyShutdown() const;

    /**
     * @brief Clear the emergency shutdown condition.
     *
     * Should only be called after the underlying condition is resolved.
     */
    void clearEmergency();

    /**
     * @brief Get a human-readable string for a safety event.
     * @param event Safety event type.
     * @return String description of the event.
     */
    static const char* eventToString(SafetyEvent event);

    /**
     * @brief Update thresholds from remote config.
     */
    void updateThresholds(float brownoutV, float overvoltageV,
                          float overcurrentA, float overtempC,
                          float cellDiffMaxV, unsigned long sensorTimeoutMs);

private:
    SafetyStatus _status;
    bool _initialized;

    // Configurable thresholds (defaults from config.h)
    float _brownoutV;
    float _overvoltageV;
    float _overcurrentA;
    float _overtempC;
    float _cellDiffMaxV;
    unsigned long _sensorTimeoutMs;

    /**
     * @brief Check brownout condition.
     */
    void checkBrownout(const SensorSystemState& state);

    /**
     * @brief Check overvoltage condition.
     */
    void checkOvervoltage(const SensorSystemState& state);

    /**
     * @brief Check overcurrent condition.
     */
    void checkOvercurrent(const SensorSystemState& state);

    /**
     * @brief Check over-temperature condition.
     */
    void checkOvertemp(const SensorSystemState& state);

    /**
     * @brief Check cell balance condition.
     */
    void checkCellBalance(const SensorSystemState& state);

    /**
     * @brief Check sensor timeout condition.
     */
    void checkSensorTimeout(const SensorSystemState& state);

    /**
     * @brief Trigger a safety event.
     */
    void triggerEvent(SafetyEvent event);
};

#endif // SEMS_SAFETY_ENGINE_H
