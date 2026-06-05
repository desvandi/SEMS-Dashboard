/**
 * @file CellMonitor.h
 * @brief 8S LiFePO4 individual cell voltage monitoring via dual ADS1115
 *
 * Measures cumulative stack voltages through voltage dividers:
 * - 360kΩ from cell tap → ADS1115 input
 * - 10kΩ from ADS1115 input → GND
 * - Divider ratio: 10/370 ≈ 0.02703
 * - Multiplier: 370/10 = 37.0
 *
 * ADS1115 #1 (0x48): CH0=Cell1+, CH1=Cell2+, CH2=Cell3+, CH3=Cell4+
 * ADS1115 #2 (0x49): CH0=Cell5+, CH1=Cell6+, CH2=Cell7+, CH3=Cell8+
 *
 * Individual cell voltages by subtraction:
 *   Cell1 = raw_CH0[dev1] * 37.0
 *   Cell2 = (raw_CH1[dev1] - raw_CH0[dev1]) * 37.0
 *   Cell3 = (raw_CH2[dev1] - raw_CH1[dev1]) * 37.0
 *   Cell4 = (raw_CH3[dev1] - raw_CH2[dev1]) * 37.0
 *   Cell5 = (raw_CH0[dev2] - raw_CH3[dev1]) * 37.0  (cross-device!)
 *   Cell6 = (raw_CH1[dev2] - raw_CH0[dev2]) * 37.0
 *   Cell7 = (raw_CH2[dev2] - raw_CH1[dev2]) * 37.0
 *   Cell8 = (raw_CH3[dev2] - raw_CH2[dev2]) * 37.0
 *
 * PGA gain 4 (±1.024V FSR) is used since max input ≈ 0.789V.
 * Resolution: ~1.16mV per cell volt step.
 */

#ifndef SEMS_CELL_MONITOR_H
#define SEMS_CELL_MONITOR_H

#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_ADS1115.h>
#include "config.h"

/**
 * @struct CellData
 * @brief Contains all 8 cell voltage readings and derived values.
 */
struct CellData {
    float cellVoltage[NUM_CELLS];  // Individual cell voltages (V)
    float totalVoltage;             // Sum of all cell voltages (V)
    float minCellV;                // Minimum cell voltage (V)
    float maxCellV;                // Maximum cell voltage (V)
    float avgCellV;                // Average cell voltage (V)
    float cellDiff;                // Max - Min cell voltage (imbalance)
    bool dataValid;                // true if reading was successful
    bool ads1115_1Online;          // true if ADS1115 #1 is responding
    bool ads1115_2Online;          // true if ADS1115 #2 is responding
    unsigned long timestamp;       // millis() of last successful reading
};

/**
 * @class CellMonitor
 * @brief Manages dual ADS1115 cell voltage monitoring for 8S LiFePO4.
 */
class CellMonitor {
public:
    CellMonitor();

    /**
     * @brief Initialize both ADS1115 devices.
     * @param wire Pointer to TwoWire instance (default Wire).
     * @return true if at least one ADS1115 was found.
     */
    bool begin(TwoWire* wire = &Wire);

    /**
     * @brief Read all cell voltages from both ADS1115 devices.
     *
     * Reads 4 channels from each ADS1115, applies voltage divider
     * correction, calculates individual cell voltages by subtraction,
     * and computes min/max/avg/diff statistics.
     *
     * @return true if all readings were successful.
     */
    bool read();

    /**
     * @brief Get the current cell data.
     * @return Const reference to the latest CellData.
     */
    const CellData& getData() const;

    /**
     * @brief Check if cell monitoring is operational.
     * @return true if at least one ADS1115 is online.
     */
    bool isOnline() const;

    /**
     * @brief Get the last reading timestamp.
     * @return millis() value of last successful read.
     */
    unsigned long getLastReadTime() const;

    /**
     * @brief Check if a specific cell is within safe voltage range.
     * @param cellIndex Cell number (0-7).
     * @return true if cell voltage is between 2.0V and 3.80V.
     */
    bool isCellSafe(int cellIndex) const;

    /**
     * @brief Get the total battery voltage from cell readings.
     * @return Sum of all cell voltages (V).
     */
    float getTotalVoltage() const;

private:
    Adafruit_ADS1115 _ads1;   // ADS1115 #1 - Cells 1-4
    Adafruit_ADS1115 _ads2;   // ADS1115 #2 - Cells 5-8
    CellData _data;           // Latest cell voltage data
    bool _initialized;        // Initialization flag
    unsigned long _lastRead;  // Last successful read timestamp

    // Moving average buffers for raw ADC readings
    static const int FILTER_SIZE = 5;
    float _rawBuffer1[4][FILTER_SIZE];  // ADS1115 #1, 4 channels
    float _rawBuffer2[4][FILTER_SIZE];  // ADS1115 #2, 4 channels
    int _filterIndex;
    bool _filterFilled;

    /**
     * @brief Read a single channel from an ADS1115 device.
     * @param ads Pointer to Adafruit_ADS1115 instance.
     * @param channel Channel number (0-3).
     * @return Voltage at the ADC input pin in volts, or -1.0 on error.
     */
    float readChannel(Adafruit_ADS1115* ads, int channel);

    /**
     * @brief Apply moving average filter to raw reading.
     * @param buffer Pointer to circular buffer.
     * @param newReading New raw voltage value.
     * @param bufIndex Current filter index (shared across all channels).
     * @return Filtered voltage value.
     */
    float applyFilter(float buffer[FILTER_SIZE], float newReading);
};

#endif // SEMS_CELL_MONITOR_H
