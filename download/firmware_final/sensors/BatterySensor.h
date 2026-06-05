/**
 * @file BatterySensor.h
 * @brief Battery voltage and current sensing via INA219 + direct ADC backup
 *
 * Primary sensor: INA219 (I2C) for bus voltage and shunt current
 * Backup sensor: ESP32 ADC (GPIO 4) for direct battery voltage measurement
 *
 * The INA219 measures:
 *   - Bus voltage (0-32V range)
 *   - Shunt voltage across 10mOhm resistor → current
 *   - Calculated power = voltage × current
 *
 * The backup ADC provides a voltage divider reading in case the INA219
 * fails or needs cross-validation.
 */

#ifndef SEMS_BATTERY_SENSOR_H
#define SEMS_BATTERY_SENSOR_H

#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_INA219.h>
#include "config.h"

/**
 * @struct BatteryData
 * @brief Contains all battery measurement data from INA219 and backup ADC.
 */
struct BatteryData {
    float voltage;           // INA219 bus voltage (V)
    float current;           // INA219 shunt current (A), positive = charging
    float power;             // Calculated power (W)
    float shuntVoltage;      // Shunt voltage (mV)
    float backupVoltage;     // Direct ADC backup voltage (V)
    bool ina219Online;       // true if INA219 is responding
    bool dataValid;          // true if reading was successful
    unsigned long timestamp; // millis() of last successful reading
};

/**
 * @class BatterySensor
 * @brief Manages INA219 battery monitoring and ADC backup voltage reading.
 */
class BatterySensor {
public:
    BatterySensor();

    /**
     * @brief Initialize the INA219 sensor and ADC backup pin.
     * @param wire Pointer to TwoWire instance (default Wire).
     * @return true if INA219 is detected and configured.
     */
    bool begin(TwoWire* wire = &Wire);

    /**
     * @brief Read battery voltage, current, and power from INA219.
     *
     * Also reads backup ADC voltage for cross-validation.
     * Updates the internal BatteryData structure.
     *
     * @return true if at least the INA219 reading succeeded.
     */
    bool read();

    /**
     * @brief Get the current battery data.
     * @return Const reference to the latest BatteryData.
     */
    const BatteryData& getData() const;

    /**
     * @brief Check if the INA219 sensor is online.
     * @return true if INA219 responded to the last read.
     */
    bool isOnline() const;

    /**
     * @brief Get the last reading timestamp.
     * @return millis() value of last successful read.
     */
    unsigned long getLastReadTime() const;

    /**
     * @brief Configure INA219 calibration for specific shunt resistor.
     * @param shuntMilliohm Shunt resistor value in milliohms.
     * @param maxExpectedA Maximum expected current in Amps.
     */
    void setCalibration(float shuntMilliohm, float maxExpectedA);

private:
    Adafruit_INA219 _ina219;     // INA219 sensor instance
    BatteryData _data;           // Latest sensor readings
    uint16_t _ina219Addr;        // I2C address
    float _shuntMilliohm;        // Shunt resistor value
    float _maxExpectedA;         // Max expected current
    unsigned long _lastRead;     // Last successful read timestamp
    bool _initialized;           // Initialization flag

    /**
     * @brief Read backup battery voltage via ADC (GPIO 4).
     * @return Battery voltage in volts, or -1.0 if ADC fails.
     */
    float readBackupADC();

    /**
     * @brief Apply moving average filter to voltage reading.
     * @param newReading New voltage value.
     * @return Filtered voltage value.
     */
    float filterVoltage(float newReading);

    /**
     * @brief Apply moving average filter to current reading.
     * @param newReading New current value.
     * @return Filtered current value.
     */
    float filterCurrent(float newReading);

    static const int FILTER_SIZE = 5;  // Moving average window size
    float _voltageBuffer[FILTER_SIZE]; // Voltage filter buffer
    float _currentBuffer[FILTER_SIZE]; // Current filter buffer
    int _filterIndex;                   // Current position in circular buffer
    bool _filterFilled;                  // Buffer has been filled once
};

#endif // SEMS_BATTERY_SENSOR_H
