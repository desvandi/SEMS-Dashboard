/**
 * @file SensorEngine.cpp
 * @brief Sensor orchestration implementation
 */

#include "SensorEngine.h"
#include "../utils/SerialDebugger.h"

// ============================================================================
// CONSTRUCTOR
// ============================================================================

SensorEngine::SensorEngine()
    : _state({}),
      _initialized(false),
      _sensorTimer(SENSOR_POLL_INTERVAL_MS),
      _pirTimer(PIR_CHECK_INTERVAL_MS),
      _rmsTimer(100),  // 100ms for RMS calculation window
      _stateTimer(SENSOR_POLL_INTERVAL_MS),
      _lastACSSample(0) {
    memset(&_state, 0, sizeof(_state));
}

// ============================================================================
// INITIALIZATION
// ============================================================================

bool SensorEngine::begin(TwoWire* wire) {
    DBG_ENGINE("SensorEngine: Initializing all sensors...");
    SerialDebugger::separator();

    bool criticalOK = true;

    // -----------------------------------------------------------------------
    // Initialize I2C sensors (order matters for shared bus)
    // -----------------------------------------------------------------------

    // 1. Battery sensor (INA219) - CRITICAL
    if (_batterySensor.begin(wire)) {
        DBG_ENGINE("SensorEngine: Battery sensor OK");
    } else {
        DBG_ENGINE("SensorEngine: WARNING - Battery sensor FAILED!");
        criticalOK = false;
    }

    // 2. Cell monitor (ADS1115 x2) - IMPORTANT
    if (_cellMonitor.begin(wire)) {
        DBG_ENGINE("SensorEngine: Cell monitor OK");
    } else {
        DBG_ENGINE("SensorEngine: WARNING - Cell monitor FAILED!");
    }

    // 3. SHT31 (temperature/humidity) - OPTIONAL
    if (_sht31.begin(wire)) {
        DBG_ENGINE("SensorEngine: SHT31 OK");
    } else {
        DBG_ENGINE("SensorEngine: SHT31 not available (non-critical)");
    }

    // 4. RTC (DS3231) - IMPORTANT for scheduling
    if (_rtc.begin(wire)) {
        DBG_ENGINE("SensorEngine: RTC OK - %s",
                   _rtc.getFormattedTime().c_str());
    } else {
        DBG_ENGINE("SensorEngine: WARNING - RTC FAILED!");
    }

    // -----------------------------------------------------------------------
    // Initialize non-I2C sensors
    // -----------------------------------------------------------------------

    // 5. ACS712 current sensor - IMPORTANT
    if (_acs712.begin()) {
        DBG_ENGINE("SensorEngine: ACS712 OK (zero=%.1f ADC)",
                   _acs712.getZeroOffset());
    } else {
        DBG_ENGINE("SensorEngine: WARNING - ACS712 FAILED!");
    }

    // 6. PIR motion sensors - OPTIONAL
    _pir.begin();
    DBG_ENGINE("SensorEngine: PIR sensors initialized");

    // -----------------------------------------------------------------------
    // Finalize
    // -----------------------------------------------------------------------
    _initialized = true;

    // Perform first state aggregation
    _sensorTimer.force();
    _pirTimer.force();
    aggregateState();

    SerialDebugger::separator();
    DBG_ENGINE("SensorEngine: Initialization complete (critical=%s)",
               criticalOK ? "OK" : "DEGRADED");

    return criticalOK;
}

// ============================================================================
// MAIN LOOP (called every Arduino loop() iteration)
// ============================================================================

void SensorEngine::loop() {
    if (!_initialized) return;

    // -----------------------------------------------------------------------
    // ACS712 continuous sampling (~1kHz)
    // This runs as fast as possible in the main loop
    // -----------------------------------------------------------------------
    unsigned long now = micros();
    if (now - _lastACSSample >= ACS_SAMPLE_INTERVAL_US) {
        _acs712.sample();
        _lastACSSample = now;
    }

    // -----------------------------------------------------------------------
    // ACS712 RMS calculation (every 100ms = 100 samples window)
    // -----------------------------------------------------------------------
    if (_rmsTimer.elapsed()) {
        _acs712.calculateRMS();
    }

    // -----------------------------------------------------------------------
    // I2C sensor polling (every 1 second)
    // -----------------------------------------------------------------------
    if (_sensorTimer.elapsed()) {
        // Read battery (INA219)
        _batterySensor.read();

        // Read cell voltages (ADS1115 x2)
        _cellMonitor.read();

        // Read temperature/humidity (SHT31)
        _sht31.read();

        // Read RTC
        _rtc.read();
    }

    // -----------------------------------------------------------------------
    // PIR sensors (every 200ms)
    // -----------------------------------------------------------------------
    if (_pirTimer.elapsed()) {
        _pir.update();
    }

    // -----------------------------------------------------------------------
    // State aggregation (every 1 second)
    // -----------------------------------------------------------------------
    if (_stateTimer.elapsed()) {
        aggregateState();
    }
}

// ============================================================================
// STATE AGGREGATION
// ============================================================================

void SensorEngine::aggregateState() {
    // Battery (INA219)
    const BatteryData& bat = _batterySensor.getData();
    _state.batteryVoltage = bat.voltage;
    _state.batteryCurrent = bat.current;
    _state.batteryPower = bat.power;
    _state.batteryBackupVoltage = bat.backupVoltage;
    _state.batteryOnline = bat.ina219Online;

    // Cell voltages (ADS1115)
    const CellData& cell = _cellMonitor.getData();
    for (int i = 0; i < NUM_CELLS; i++) {
        _state.cellVoltages[i] = cell.cellVoltage[i];
    }
    _state.totalCellVoltage = cell.totalVoltage;
    _state.minCellV = cell.minCellV;
    _state.maxCellV = cell.maxCellV;
    _state.cellDiff = cell.cellDiff;
    _state.cellMonitorOnline = _cellMonitor.isOnline();

    // ACS712 (inverter current)
    const ACS712Data& acs = _acs712.getData();
    _state.inverterCurrent = acs.currentA;
    _state.inverterPeakCurrent = acs.peakCurrentA;
    _state.acs712Online = acs.calibrated;

    // SHT31 (environment)
    const SHT31Data& sht = _sht31.getData();
    _state.roomTemp = sht.temperature;
    _state.roomHumidity = sht.humidity;
    _state.sht31Online = sht.sensorOnline;

    // RTC (time)
    const RTCData& rtc = _rtc.getData();
    _state.unixTime = rtc.unixTime;
    _state.year = rtc.year;
    _state.month = rtc.month;
    _state.day = rtc.day;
    _state.hour = rtc.hour;
    _state.minute = rtc.minute;
    _state.second = rtc.second;
    _state.dayOfWeek = rtc.dayOfWeek;
    _state.rtcOnline = rtc.rtcOnline;

    // PIR (motion)
    const PIRData& pir = _pir.getData();
    _state.anyMotion = pir.anyMotion;
    _state.pirMotionMask = pir.motionMask;
    for (int i = 0; i < PIR_COUNT; i++) {
        _state.pirStates[i] = pir.sensors[i].currentState;
    }

    // System info
    _state.wifiRSSI = WiFi.RSSI();
    _state.freeHeap = ESP.getFreeHeap();
    _state.uptimeSeconds = millis() / 1000UL;
    _state.lastSensorUpdate = millis();

    // Check if all critical sensors are valid
    _state.allSensorsValid = bat.dataValid && cell.dataValid && acs.dataValid;
}

// ============================================================================
// GETTER
// ============================================================================

const SensorSystemState& SensorEngine::getState() const {
    return _state;
}
