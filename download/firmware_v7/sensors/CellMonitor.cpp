/**
 * @file CellMonitor.cpp
 * @brief Cell voltage monitoring implementation for 8S LiFePO4 via dual ADS1115
 */

#include "CellMonitor.h"
#include "../utils/SerialDebugger.h"

// ============================================================================
// CONSTRUCTOR
// ============================================================================

CellMonitor::CellMonitor()
    : _ads1(ADS1115_ADDR_1),
      _ads2(ADS1115_ADDR_2),
      _data({}),
      _initialized(false),
      _lastRead(0),
      _filterIndex(0),
      _filterFilled(false) {
    memset(&_data, 0, sizeof(_data));
    memset(_rawBuffer1, 0, sizeof(_rawBuffer1));
    memset(_rawBuffer2, 0, sizeof(_rawBuffer2));
    _data.dataValid = false;
}

// ============================================================================
// INITIALIZATION
// ============================================================================

bool CellMonitor::begin(TwoWire* wire) {
    DBG_SENSOR("CellMonitor: Initializing dual ADS1115...");

    bool ads1Found = false;
    bool ads2Found = false;

    // Initialize ADS1115 #1 (Cells 1-4)
    _ads1 = Adafruit_ADS1115(ADS1115_ADDR_1);
    if (_ads1.begin(wire)) {
        _ads1.setGain(ADS1115_PGA);
        _data.ads1115_1Online = true;
        ads1Found = true;
        DBG_SENSOR("CellMonitor: ADS1115 #1 found at 0x%02X", ADS1115_ADDR_1);
    } else {
        _data.ads1115_1Online = false;
        DBG_SENSOR("CellMonitor: ADS1115 #1 NOT FOUND at 0x%02X!", ADS1115_ADDR_1);
    }

    // Initialize ADS1115 #2 (Cells 5-8)
    _ads2 = Adafruit_ADS1115(ADS1115_ADDR_2);
    if (_ads2.begin(wire)) {
        _ads2.setGain(ADS1115_PGA);
        _data.ads1115_2Online = true;
        ads2Found = true;
        DBG_SENSOR("CellMonitor: ADS1115 #2 found at 0x%02X", ADS1115_ADDR_2);
    } else {
        _data.ads1115_2Online = false;
        DBG_SENSOR("CellMonitor: ADS1115 #2 NOT FOUND at 0x%02X!", ADS1115_ADDR_2);
    }

    if (!ads1Found && !ads2Found) {
        DBG_SENSOR("CellMonitor: FATAL - No ADS1115 devices found!");
        return false;
    }

    // Initialize filter buffers
    // Prime with zeros (will be overwritten on first valid reads)
    _filterIndex = 0;
    _filterFilled = false;
    for (int ch = 0; ch < 4; ch++) {
        for (int i = 0; i < FILTER_SIZE; i++) {
            _rawBuffer1[ch][i] = 0.0f;
            _rawBuffer2[ch][i] = 0.0f;
        }
    }

    _initialized = true;
    DBG_SENSOR("CellMonitor: Ready (Device1=%s, Device2=%s, Gain=4/±1.024V)",
               ads1Found ? "OK" : "FAIL", ads2Found ? "OK" : "FAIL");

    return true;
}

// ============================================================================
// MAIN READ
// ============================================================================

bool CellMonitor::read() {
    if (!_initialized) return false;

    float rawCumulative[NUM_CELLS];
    bool allOK = true;

    // -----------------------------------------------------------------------
    // Read ADS1115 #1 (Cells 1-4) - 4 channels
    // -----------------------------------------------------------------------
    if (_data.ads1115_1Online) {
        for (int ch = 0; ch < 4; ch++) {
            float raw = readChannel(&_ads1, ch);
            if (raw < 0.0f) {
                allOK = false;
                rawCumulative[ch] = 0.0f;  // Error sentinel
            } else {
                // Apply moving average filter before multiplication
                rawCumulative[ch] = applyFilter(_rawBuffer1[ch], raw);
            }
        }
    } else {
        for (int ch = 0; ch < 4; ch++) rawCumulative[ch] = 0.0f;
        allOK = false;
    }

    // -----------------------------------------------------------------------
    // Read ADS1115 #2 (Cells 5-8) - 4 channels
    // -----------------------------------------------------------------------
    if (_data.ads1115_2Online) {
        for (int ch = 0; ch < 4; ch++) {
            float raw = readChannel(&_ads2, ch);
            if (raw < 0.0f) {
                allOK = false;
                rawCumulative[ch + 4] = 0.0f;
            } else {
                rawCumulative[ch + 4] = applyFilter(_rawBuffer2[ch], raw);
            }
        }
    } else {
        for (int ch = 4; ch < 8; ch++) rawCumulative[ch] = 0.0f;
        allOK = false;
    }

    // -----------------------------------------------------------------------
    // Calculate individual cell voltages by subtraction
    // -----------------------------------------------------------------------
    // At this point, rawCumulative[] holds the filtered ADC input voltages
    // We need to multiply by the voltage divider ratio to get actual voltages
    float stackV[NUM_CELLS];
    for (int i = 0; i < NUM_CELLS; i++) {
        stackV[i] = rawCumulative[i] * VOLTAGE_MULTIPLIER;
    }

    // Calculate individual cell voltages by subtraction
    _data.cellVoltage[0] = stackV[0];  // Cell 1 = Stack to Cell 1

    // Cells 2-4 (within ADS1115 #1)
    for (int i = 1; i < 4; i++) {
        _data.cellVoltage[i] = stackV[i] - stackV[i - 1];
    }

    // Cell 5 (cross-device boundary: ADS1115 #1 CH3 to ADS1115 #2 CH0)
    _data.cellVoltage[4] = stackV[4] - stackV[3];

    // Cells 6-8 (within ADS1115 #2)
    for (int i = 5; i < NUM_CELLS; i++) {
        _data.cellVoltage[i] = stackV[i] - stackV[i - 1];
    }

    // -----------------------------------------------------------------------
    // Calculate statistics
    // -----------------------------------------------------------------------
    _data.totalVoltage = 0.0f;
    _data.minCellV = 999.0f;
    _data.maxCellV = -999.0f;

    for (int i = 0; i < NUM_CELLS; i++) {
        _data.totalVoltage += _data.cellVoltage[i];

        if (_data.cellVoltage[i] < _data.minCellV) {
            _data.minCellV = _data.cellVoltage[i];
        }
        if (_data.cellVoltage[i] > _data.maxCellV) {
            _data.maxCellV = _data.cellVoltage[i];
        }
    }

    _data.avgCellV = _data.totalVoltage / (float)NUM_CELLS;
    _data.cellDiff = _data.maxCellV - _data.minCellV;
    _data.dataValid = allOK;
    _data.timestamp = millis();
    _lastRead = _data.timestamp;

    // Advance filter index for next cycle
    _filterIndex = (_filterIndex + 1) % FILTER_SIZE;
    if (_filterIndex == 0) _filterFilled = true;

    return allOK;
}

// ============================================================================
// SINGLE CHANNEL READ
// ============================================================================

float CellMonitor::readChannel(Adafruit_ADS1115* ads, int channel) {
    int16_t adcValue;

    // ADS1115 single-ended channel reading
    switch (channel) {
        case 0: adcValue = ads->readADC_SingleEnded(0); break;
        case 1: adcValue = ads->readADC_SingleEnded(1); break;
        case 2: adcValue = ads->readADC_SingleEnded(2); break;
        case 3: adcValue = ads->readADC_SingleEnded(3); break;
        default: return -1.0f;
    }

    // Check for reading errors
    if (adcValue == 0 && channel > 0) {
        // CH0 could be 0, but higher channels shouldn't read 0 if cells are connected
        // This might indicate a wiring issue
        DBG_SENSOR("CellMonitor: CH%d read 0 on device", channel);
    }

    // Convert ADC value to voltage
    // At GAIN_FOUR (±1.024V): 1 LSB = 1.024V / 32768 = 0.00003125V = 31.25µV
    float voltage = (float)adcValue * ADS1115_LSB_V;

    return voltage;
}

// ============================================================================
// MOVING AVERAGE FILTER
// ============================================================================

float CellMonitor::applyFilter(float buffer[FILTER_SIZE], float newReading) {
    buffer[_filterIndex] = newReading;

    float sum = 0.0f;
    int count = _filterFilled ? FILTER_SIZE : (_filterIndex + 1);
    for (int i = 0; i < count; i++) {
        sum += buffer[i];
    }
    return sum / count;
}

// ============================================================================
// GETTERS
// ============================================================================

const CellData& CellMonitor::getData() const {
    return _data;
}

bool CellMonitor::isOnline() const {
    return _data.ads1115_1Online || _data.ads1115_2Online;
}

unsigned long CellMonitor::getLastReadTime() const {
    return _lastRead;
}

bool CellMonitor::isCellSafe(int cellIndex) const {
    if (cellIndex < 0 || cellIndex >= NUM_CELLS) return false;
    return (_data.cellVoltage[cellIndex] >= SAFETY_CELL_UNDERVOLTAGE_V &&
            _data.cellVoltage[cellIndex] <= SAFETY_CELL_OVERVOLTAGE_V);
}

float CellMonitor::getTotalVoltage() const {
    return _data.totalVoltage;
}
