/**
 * @file SafetyEngine.cpp
 * @brief Safety monitoring and protection engine implementation
 */

#include "SafetyEngine.h"
#include "../utils/SerialDebugger.h"

// ============================================================================
// CONSTRUCTOR
// ============================================================================

SafetyEngine::SafetyEngine()
    : _status({}),
      _initialized(false),
      _brownoutV(SAFETY_BROWNOUT_V),
      _overvoltageV(SAFETY_OVERVOLTAGE_V),
      _overcurrentA(SAFETY_OVERCURRENT_A),
      _overtempC(SAFETY_OVERTEMP_C),
      _cellDiffMaxV(SAFETY_CELL_DIFF_MAX_V),
      _sensorTimeoutMs(SAFETY_SENSOR_TIMEOUT_MS) {
    memset(&_status, 0, sizeof(_status));
    _status.activeEvent = SAFETY_NONE;
}

// ============================================================================
// INITIALIZATION
// ============================================================================

void SafetyEngine::begin() {
    DBG_SAFETY("SafetyEngine: Initializing...");
    DBG_SAFETY("  Brownout:    < %.1fV", _brownoutV);
    DBG_SAFETY("  Overvoltage: > %.1fV", _overvoltageV);
    DBG_SAFETY("  Overcurrent: > %.1fA", _overcurrentA);
    DBG_SAFETY("  Overtemp:    > %.1f°C", _overtempC);
    DBG_SAFETY("  Cell Imbal:  > %.2fV", _cellDiffMaxV);
    DBG_SAFETY("  Sensor TO:   > %lums", _sensorTimeoutMs);

    _initialized = true;
}

// ============================================================================
// MAIN LOOP
// ============================================================================

void SafetyEngine::loop(const SensorSystemState& sensorState) {
    if (!_initialized) return;

    _status.activeAlerts = 0;
    _status.lastCheck = millis();

    // Check each safety condition
    checkBrownout(sensorState);
    checkOvervoltage(sensorState);
    checkOvercurrent(sensorState);
    checkOvertemp(sensorState);
    checkCellBalance(sensorState);
    checkSensorTimeout(sensorState);

    // If no alerts are active, clear the active event
    if (_status.activeAlerts == 0) {
        _status.activeEvent = SAFETY_NONE;
        _status.emergencyShutdown = false;
    }
}

// ============================================================================
// CONDITION CHECKS
// ============================================================================

void SafetyEngine::checkBrownout(const SensorSystemState& state) {
    if (state.batteryVoltage < _brownoutV && state.batteryOnline) {
        _status.brownout = true;
        _status.activeAlerts++;
        triggerEvent(SAFETY_BROWNOUT);
        DBG_SAFETY("ALERT: BROWNOUT - Battery at %.2fV (threshold %.1fV)!",
                   state.batteryVoltage, _brownoutV);
    } else if (_status.brownout) {
        _status.brownout = false;
        DBG_SAFETY("CLEARED: Brownout - Battery at %.2fV", state.batteryVoltage);
    }
}

void SafetyEngine::checkOvervoltage(const SensorSystemState& state) {
    if (state.batteryVoltage > _overvoltageV && state.batteryOnline) {
        _status.overvoltage = true;
        _status.activeAlerts++;
        triggerEvent(SAFETY_OVERVOLTAGE);
        DBG_SAFETY("ALERT: OVERVOLTAGE - Battery at %.2fV (threshold %.1fV)!",
                   state.batteryVoltage, _overvoltageV);
    } else if (_status.overvoltage) {
        _status.overvoltage = false;
        DBG_SAFETY("CLEARED: Overvoltage - Battery at %.2fV", state.batteryVoltage);
    }
}

void SafetyEngine::checkOvercurrent(const SensorSystemState& state) {
    float absCurrent = fabsf(state.batteryCurrent);
    if (absCurrent > _overcurrentA && state.batteryOnline) {
        _status.overcurrent = true;
        _status.activeAlerts++;
        triggerEvent(SAFETY_OVERCURRENT);
        DBG_SAFETY("ALERT: OVERCURRENT - %.1fA (threshold %.1fA)!",
                   absCurrent, _overcurrentA);
    } else if (_status.overcurrent) {
        _status.overcurrent = false;
        DBG_SAFETY("CLEARED: Overcurrent - %.1fA", absCurrent);
    }
}

void SafetyEngine::checkOvertemp(const SensorSystemState& state) {
    if (state.roomTemp > _overtempC && state.sht31Online) {
        _status.overtemp = true;
        _status.activeAlerts++;
        triggerEvent(SAFETY_OVERTEMP);
        DBG_SAFETY("ALERT: OVERTEMP - %.1f°C (threshold %.1f°C)!",
                   state.roomTemp, _overtempC);
    } else if (_status.overtemp) {
        _status.overtemp = false;
        DBG_SAFETY("CLEARED: Overtemp - %.1f°C", state.roomTemp);
    }
}

void SafetyEngine::checkCellBalance(const SensorSystemState& state) {
    if (!state.cellMonitorOnline) return;

    // Check individual cell undervoltage
    bool anyUnder = false;
    bool anyOver = false;
    for (int i = 0; i < NUM_CELLS; i++) {
        if (state.cellVoltages[i] < SAFETY_CELL_UNDERVOLTAGE_V) {
            anyUnder = true;
            DBG_SAFETY("ALERT: Cell %d undervoltage: %.3fV (min %.2fV)",
                       i + 1, state.cellVoltages[i], SAFETY_CELL_UNDERVOLTAGE_V);
        }
        if (state.cellVoltages[i] > SAFETY_CELL_OVERVOLTAGE_V) {
            anyOver = true;
            DBG_SAFETY("ALERT: Cell %d overvoltage: %.3fV (max %.2fV)",
                       i + 1, state.cellVoltages[i], SAFETY_CELL_OVERVOLTAGE_V);
        }
    }

    if (anyUnder) {
        _status.cellUndervoltage = true;
        _status.activeAlerts++;
        triggerEvent(SAFETY_CELL_UNDERVOLTAGE);
        _status.emergencyShutdown = true;
    } else {
        _status.cellUndervoltage = false;
    }

    if (anyOver) {
        _status.cellOvervoltage = true;
        _status.activeAlerts++;
        triggerEvent(SAFETY_CELL_OVERVOLTAGE);
    } else {
        _status.cellOvervoltage = false;
    }

    // Check cell imbalance
    if (state.cellDiff > _cellDiffMaxV) {
        _status.cellImbalance = true;
        _status.activeAlerts++;
        triggerEvent(SAFETY_CELL_IMBALANCE);
        DBG_SAFETY("ALERT: CELL IMBALANCE - Diff %.3fV (threshold %.2fV)",
                   state.cellDiff, _cellDiffMaxV);
    } else if (_status.cellImbalance) {
        _status.cellImbalance = false;
        DBG_SAFETY("CLEARED: Cell imbalance - Diff %.3fV", state.cellDiff);
    }
}

void SafetyEngine::checkSensorTimeout(const SensorSystemState& state) {
    unsigned long now = millis();

    bool timeout = false;

    // Check if any sensor hasn't updated within the timeout period
    if (state.lastSensorUpdate > 0 && (now - state.lastSensorUpdate) > _sensorTimeoutMs) {
        timeout = true;
    }

    // Also check individual sensor timestamps if needed
    // (Currently using the aggregated timestamp)

    if (timeout) {
        _status.sensorTimeout = true;
        _status.activeAlerts++;
        triggerEvent(SAFETY_SENSOR_TIMEOUT);
        DBG_SAFETY("ALERT: SENSOR TIMEOUT - No update for %lums",
                   now - state.lastSensorUpdate);
    } else if (_status.sensorTimeout) {
        _status.sensorTimeout = false;
    }
}

// ============================================================================
// EVENT MANAGEMENT
// ============================================================================

void SafetyEngine::triggerEvent(SafetyEvent event) {
    _status.activeEvent = event;
    _status.lastEvent = event;

    if (_status.eventStart == 0) {
        _status.eventStart = millis();
    }

    // Emergency shutdown conditions
    if (event == SAFETY_CELL_UNDERVOLTAGE || event == SAFETY_OVERCURRENT) {
        _status.emergencyShutdown = true;
    }
}

void SafetyEngine::clearEmergency() {
    _status.emergencyShutdown = false;
    _status.eventStart = 0;
    DBG_SAFETY("Emergency condition cleared by operator");
}

// ============================================================================
// GETTERS & UTILITIES
// ============================================================================

const SafetyStatus& SafetyEngine::getStatus() const {
    return _status;
}

bool SafetyEngine::hasAlert() const {
    return _status.activeAlerts > 0;
}

bool SafetyEngine::isEmergencyShutdown() const {
    return _status.emergencyShutdown;
}

const char* SafetyEngine::eventToString(SafetyEvent event) {
    switch (event) {
        case SAFETY_NONE:              return "None";
        case SAFETY_BROWNOUT:          return "Brownout";
        case SAFETY_OVERVOLTAGE:       return "Overvoltage";
        case SAFETY_OVERCURRENT:       return "Overcurrent";
        case SAFETY_OVERTEMP:          return "Overtemperature";
        case SAFETY_CELL_IMBALANCE:    return "Cell Imbalance";
        case SAFETY_CELL_UNDERVOLTAGE: return "Cell Undervoltage";
        case SAFETY_CELL_OVERVOLTAGE:  return "Cell Overvoltage";
        case SAFETY_SENSOR_TIMEOUT:    return "Sensor Timeout";
        default:                       return "Unknown";
    }
}

void SafetyEngine::updateThresholds(float brownoutV, float overvoltageV,
                                     float overcurrentA, float overtempC,
                                     float cellDiffMaxV, unsigned long sensorTimeoutMs) {
    _brownoutV = brownoutV;
    _overvoltageV = overvoltageV;
    _overcurrentA = overcurrentA;
    _overtempC = overtempC;
    _cellDiffMaxV = cellDiffMaxV;
    _sensorTimeoutMs = sensorTimeoutMs;
}
