/**
 * @file PIRManager.h
 * @brief 4-channel PIR motion sensor manager with debounce
 *
 * Manages 4 PIR (Passive Infrared) motion sensors connected to
 * digital GPIO pins. Each sensor outputs HIGH when motion is detected.
 *
 * Features:
 *   - Debounce filtering (200ms) to prevent rapid state changes
 *   - Motion duration tracking (how long motion has been continuous)
 *   - Last motion timestamp for occupancy timeout logic
 *   - Individual sensor enable/disable
 */

#ifndef SEMS_PIR_MANAGER_H
#define SEMS_PIR_MANAGER_H

#include <Arduino.h>
#include "config.h"

/**
 * @struct PIRSensorState
 * @brief State data for a single PIR sensor.
 */
struct PIRSensorState {
    uint8_t pin;              // GPIO pin number
    bool currentState;        // Current debounced state (true = motion)
    bool previousState;       // Previous state (for edge detection)
    bool risingEdge;          // true on LOW→HIGH transition (motion detected)
    bool fallingEdge;         // true on HIGH→LOW transition (motion cleared)
    unsigned long lastChange; // millis() of last state change
    unsigned long motionStart; // millis() when motion first detected
    unsigned long lastMotion;  // millis() of most recent motion event
    bool enabled;             // true if sensor is active
    uint8_t readCount;         // Consecutive reads matching current state
};

/**
 * @struct PIRData
 * @brief Combined data from all PIR sensors.
 */
struct PIRData {
    PIRSensorState sensors[PIR_COUNT];  // Individual sensor states
    bool anyMotion;                     // true if any sensor detects motion
    uint8_t motionMask;                 // Bitmask of active motion (bit 0-3)
    unsigned long timestamp;            // millis() of last update
    bool dataValid;                     // true if reading was successful
};

/**
 * @class PIRManager
 * @brief Manages 4 PIR motion sensors with debounce and event detection.
 */
class PIRManager {
public:
    PIRManager();

    /**
     * @brief Initialize all PIR sensors.
     *
     * Configures GPIO pins as INPUT (PIR outputs active HIGH).
     * Maps pins: GPIO 32, 33, 25, 26 → PIR 1-4.
     */
    void begin();

    /**
     * @brief Update all PIR sensor states (call every ~200ms).
     *
     * Reads all pins, applies debounce logic, detects edges,
     * and updates the combined motion state.
     *
     * @return true if any sensor state changed.
     */
    bool update();

    /**
     * @brief Get the combined PIR data.
     * @return Const reference to latest PIRData.
     */
    const PIRData& getData() const;

    /**
     * @brief Check if any PIR sensor detects motion.
     * @return true if at least one sensor is active.
     */
    bool isAnyMotion() const;

    /**
     * @brief Check if a specific PIR sensor detects motion.
     * @param sensorIndex Sensor number (0-3).
     * @return true if the specified sensor detects motion.
     */
    bool isMotion(uint8_t sensorIndex) const;

    /**
     * @brief Check if a specific sensor had a rising edge (new motion).
     * @param sensorIndex Sensor number (0-3).
     * @return true if motion just started (cleared after reading).
     */
    bool risingEdge(uint8_t sensorIndex);

    /**
     * @brief Get how long motion has been continuous for a sensor.
     * @param sensorIndex Sensor number (0-3).
     * @return Duration in milliseconds since motion started, or 0 if no motion.
     */
    unsigned long motionDuration(uint8_t sensorIndex) const;

    /**
     * @brief Enable or disable a specific sensor.
     * @param sensorIndex Sensor number (0-3).
     * @param enabled true to enable, false to disable.
     */
    void setEnabled(uint8_t sensorIndex, bool enabled);

    /**
     * @brief Get the motion bitmask for telemetry.
     * @return 4-bit mask (bit 0=PIR1, bit 1=PIR2, etc.).
     */
    uint8_t getMotionMask() const;

    /**
     * @brief Check if motion has been absent for a given duration.
     * @param sensorIndex Sensor number (0-3).
     * @param timeoutMs Timeout in milliseconds.
     * @return true if no motion detected for longer than timeoutMs.
     */
    bool isMotionTimeout(uint8_t sensorIndex, unsigned long timeoutMs) const;

private:
    PIRData _data;            // Combined PIR data
    bool _initialized;        // Initialization flag

    // Pin mapping array (matches config.h)
    static const uint8_t _pins[PIR_COUNT];
};

#endif // SEMS_PIR_MANAGER_H
