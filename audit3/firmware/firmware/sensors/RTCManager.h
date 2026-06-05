/**
 * @file RTCManager.h
 * @brief DS3231 Real-Time Clock manager for time-based scheduling
 *
 * The DS3231 is a highly accurate I2C RTC with:
 *   - ±2ppm accuracy (±0.432 seconds/day)
 *   - Temperature-compensated crystal oscillator (TCXO)
 *   - Battery backup (CR2032) maintains time during power loss
 *   - Built-in temperature sensor (±3°C)
 *   - Two programmable alarms
 *
 * Used by the Schedule Engine for time-based automation and
 * by the Event Logger for accurate event timestamps.
 */

#ifndef SEMS_RTC_MANAGER_H
#define SEMS_RTC_MANAGER_H

#include <Arduino.h>
#include <Wire.h>
#include <RTClib.h>
#include "config.h"

/**
 * @struct RTCData
 * @brief Contains RTC time, date, and derived information.
 */
struct RTCData {
    DateTime now;              // Current date/time from RTC
    uint32_t unixTime;         // Unix timestamp (seconds since epoch)
    uint16_t year;
    uint8_t month;
    uint8_t day;
    uint8_t hour;
    uint8_t minute;
    uint8_t second;
    uint8_t dayOfWeek;         // 0=Sunday, 1=Monday, ..., 6=Saturday
    bool isPM;                 // true if afternoon
    float rtcTemperature;      // DS3231 internal temperature (°C)
    bool dataValid;            // true if RTC read succeeded
    bool rtcOnline;            // true if DS3231 is responding
    unsigned long timestamp;   // millis() of last read
};

/**
 * @class RTCManager
 * @brief Manages DS3231 RTC for accurate timekeeping.
 */
class RTCManager {
public:
    RTCManager();

    /**
     * @brief Initialize the DS3231 RTC.
     * @param wire Pointer to TwoWire instance (default Wire).
     * @return true if RTC was found and is running.
     */
    bool begin(TwoWire* wire = &Wire);

    /**
     * @brief Read current time from the RTC.
     *
     * Updates the internal RTCData structure with current time,
     * date, day of week, and internal temperature.
     *
     * @return true if read succeeded.
     */
    bool read();

    /**
     * @brief Get the current RTC data.
     * @return Const reference to latest RTCData.
     */
    const RTCData& getData() const;

    /**
     * @brief Get current Unix timestamp.
     * @return Unix time in seconds since Jan 1, 1970.
     */
    uint32_t getUnixTime() const;

    /**
     * @brief Get current DateTime object.
     * @return DateTime from RTClib.
     */
    DateTime getDateTime() const;

    /**
     * @brief Check if RTC is online and running.
     * @return true if RTC is operational.
     */
    bool isOnline() const;

    /**
     * @brief Set the RTC time from Unix timestamp.
     *
     * Used to synchronize RTC with NTP time from WiFi.
     *
     * @param unixTime Unix timestamp to set.
     */
    void setTime(uint32_t unixTime);

    /**
     * @brief Set the RTC time from a DateTime object.
     * @param dt DateTime to set.
     */
    void setTime(const DateTime& dt);

    /**
     * @brief Get formatted time string.
     * @return String like "2024-06-25 14:30:00".
     */
    String getFormattedTime() const;

    /**
     * @brief Check if current time is within a time window.
     *
     * Useful for schedule conditions like "between 18:00 and 22:00".
     *
     * @param startHour Start hour (0-23).
     * @param startMin Start minute (0-59).
     * @param endHour End hour (0-23).
     * @param endMin End minute (0-59).
     * @return true if current time is within the window.
     */
    bool isTimeInRange(uint8_t startHour, uint8_t startMin,
                       uint8_t endHour, uint8_t endMin) const;

    /**
     * @brief Get the DS3231 internal temperature.
     * @return Temperature in °C (from RTC's built-in sensor).
     */
    float getRTCTemperature() const;

    /**
     * @brief Check if the RTC lost power (oscillator stopped).
     * @return true if oscillator stop flag is set.
     */
    bool wasPowerLost() const;

    /**
     * @brief Clear the oscillator stop flag.
     */
    void clearPowerLostFlag();

    /**
     * @brief Get the last read timestamp.
     * @return millis() value of last successful read.
     */
    unsigned long getLastReadTime() const;

private:
    RTC_DS3231 _rtc;       // DS3231 RTC instance
    RTCData _data;          // Latest RTC data
    bool _initialized;      // Initialization flag
    unsigned long _lastRead;// Last successful read timestamp
};

#endif // SEMS_RTC_MANAGER_H
