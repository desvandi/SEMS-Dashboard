/**
 * @file SHT31Sensor.h
 * @brief Temperature and humidity sensing via SHT31 (I2C)
 *
 * The Sensirion SHT31 provides high-accuracy temperature (±0.3°C)
 * and humidity (±2% RH) measurements via I2C.
 *
 * Features:
 *   - Single-shot measurement mode (on-demand polling)
 *   - Built-in heater (optional, for condensation prevention)
 *   - CRC-8 data integrity check
 *   - 0.5s typical measurement time
 */

#ifndef SEMS_SHT31_SENSOR_H
#define SEMS_SHT31_SENSOR_H

#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_SHT31.h>
#include "config.h"

/**
 * @struct SHT31Data
 * @brief Contains temperature and humidity readings from SHT31.
 */
struct SHT31Data {
    float temperature;       // Temperature in °C
    float humidity;          // Relative humidity in %RH
    bool dataValid;          // true if reading is valid
    bool sensorOnline;       // true if SHT31 is responding
    unsigned long timestamp; // millis() of last successful reading
};

/**
 * @class SHT31Sensor
 * @brief Manages SHT31 temperature/humidity sensor via I2C.
 */
class SHT31Sensor {
public:
    SHT31Sensor();

    /**
     * @brief Initialize the SHT31 sensor.
     * @param wire Pointer to TwoWire instance (default Wire).
     * @return true if SHT31 was found and initialized.
     */
    bool begin(TwoWire* wire = &Wire);

    /**
     * @brief Read temperature and humidity from SHT31.
     *
     * @return true if reading succeeded.
     */
    bool read();

    /**
     * @brief Get the latest sensor data.
     * @return Const reference to latest SHT31Data.
     */
    const SHT31Data& getData() const;

    /**
     * @brief Check if sensor is online.
     * @return true if SHT31 is responding.
     */
    bool isOnline() const;

    /**
     * @brief Enable or disable the SHT31 internal heater.
     *
     * The heater is useful for preventing condensation in humid
     * environments, but increases temperature readings slightly.
     *
     * @param enabled true to enable heater.
     */
    void setHeater(bool enabled);

    /**
     * @brief Get the last reading timestamp.
     * @return millis() value of last successful read.
     */
    unsigned long getLastReadTime() const;

private:
    Adafruit_SHT31 _sht31;   // SHT31 sensor instance
    SHT31Data _data;         // Latest sensor readings
    bool _initialized;       // Initialization flag
    unsigned long _lastRead; // Last successful read timestamp

    // Moving average filter
    static const int FILTER_SIZE = 5;
    float _tempBuffer[FILTER_SIZE];
    float _humBuffer[FILTER_SIZE];
    int _filterIndex;
    bool _filterFilled;

    float filterTemperature(float newReading);
    float filterHumidity(float newReading);
};

#endif // SEMS_SHT31_SENSOR_H
