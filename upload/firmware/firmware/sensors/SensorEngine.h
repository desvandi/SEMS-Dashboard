/**
 * @file SensorEngine.h
 * @brief Master sensor orchestrator - coordinates all sensor polling
 *
 * The SensorEngine manages the unified polling schedule for all sensors:
 *   - INA219 (BatterySensor): Every 1 second
 *   - ADS1115 x2 (CellMonitor): Every 1 second
 *   - ACS712: Continuous sampling at ~1kHz, RMS calc every 100ms
 *   - SHT31: Every 1 second
 *   - DS3231 (RTCManager): Every 1 second
 *   - PIR sensors: Every 200ms
 *
 * All polling is non-blocking using NonBlockingTimer.
 * Provides a unified SensorSystemState structure for other engines.
 */

#ifndef SEMS_SENSOR_ENGINE_H
#define SEMS_SENSOR_ENGINE_H

#include <Arduino.h>
#include "BatterySensor.h"
#include "CellMonitor.h"
#include "ACS712Sensor.h"
#include "SHT31Sensor.h"
#include "RTCManager.h"
#include "PIRManager.h"
#include "../utils/NonBlockingTimer.h"
#include "config.h"

/**
 * @struct SensorSystemState
 * @brief Unified sensor data structure for all engines to consume.
 *
 * This is the single source of truth for all sensor readings.
 * Updated by SensorEngine::loop(), consumed by all other engines.
 */
struct SensorSystemState {
    // Battery (INA219)
    float batteryVoltage;
    float batteryCurrent;
    float batteryPower;
    float batteryBackupVoltage;
    bool batteryOnline;

    // Cell voltages (ADS1115 x2)
    float cellVoltages[NUM_CELLS];
    float totalCellVoltage;
    float minCellV;
    float maxCellV;
    float cellDiff;
    bool cellMonitorOnline;

    // Inverter current (ACS712)
    float inverterCurrent;
    float inverterPeakCurrent;
    bool acs712Online;

    // Environment (SHT31)
    float roomTemp;
    float roomHumidity;
    bool sht31Online;

    // Time (DS3231)
    uint32_t unixTime;
    int year, month, day, hour, minute, second;
    int dayOfWeek;
    bool rtcOnline;

    // Motion (PIR)
    bool pirStates[PIR_COUNT];
    uint8_t pirMotionMask;
    bool anyMotion;

    // System
    int wifiRSSI;
    uint32_t freeHeap;
    unsigned long uptimeSeconds;
    unsigned long lastSensorUpdate;
    bool allSensorsValid;
};

/**
 * @class SensorEngine
 * @brief Orchestrates all sensor polling and data aggregation.
 */
class SensorEngine {
public:
    SensorEngine();

    /**
     * @brief Initialize all sensors.
     * @param wire Pointer to TwoWire instance (default Wire).
     * @return true if critical sensors (INA219) are online.
     */
    bool begin(TwoWire* wire = &Wire);

    /**
     * @brief Main loop - call from Arduino loop().
     *
     * Handles all sensor polling timing, ACS712 continuous sampling,
     * and aggregation into SensorSystemState.
     * MUST be called every loop() iteration for non-blocking operation.
     */
    void loop();

    /**
     * @brief Get the current unified sensor state.
     * @return Const reference to the sensor system state.
     */
    const SensorSystemState& getState() const;

    /**
     * @brief Get direct access to individual sensors.
     */
    BatterySensor& getBatterySensor() { return _batterySensor; }
    CellMonitor& getCellMonitor() { return _cellMonitor; }
    ACS712Sensor& getACS712() { return _acs712; }
    SHT31Sensor& getSHT31() { return _sht31; }
    RTCManager& getRTC() { return _rtc; }
    PIRManager& getPIR() { return _pir; }

private:
    // Individual sensors
    BatterySensor _batterySensor;
    CellMonitor _cellMonitor;
    ACS712Sensor _acs712;
    SHT31Sensor _sht31;
    RTCManager _rtc;
    PIRManager _pir;

    // Unified state
    SensorSystemState _state;
    bool _initialized;

    // Non-blocking timers
    NonBlockingTimer _sensorTimer;    // 1s for I2C sensors
    NonBlockingTimer _pirTimer;       // 200ms for PIR
    NonBlockingTimer _rmsTimer;       // 100ms for ACS712 RMS calc
    NonBlockingTimer _stateTimer;     // 1s for state aggregation

    // ACS712 continuous sampling control
    unsigned long _lastACSSample;
    static const unsigned long ACS_SAMPLE_INTERVAL_US = ACS712_SAMPLE_INTERVAL_US;

    /**
     * @brief Aggregate all sensor data into SensorSystemState.
     */
    void aggregateState();
};

#endif // SEMS_SENSOR_ENGINE_H
