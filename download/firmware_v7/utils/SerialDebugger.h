/**
 * @file SerialDebugger.h
 * @brief Serial debug output helper with leveled categories and timestamps
 *
 * Provides structured debug output with severity levels, category tags,
 * and ISO-format timestamps from DS3231 RTC. All output goes to Serial
 * and can be filtered at compile time via config.h macros.
 */

#ifndef SEMS_SERIAL_DEBUGGER_H
#define SEMS_SERIAL_DEBUGGER_H

#include <Arduino.h>
#include "config.h"

/**
 * @class SerialDebugger
 * @brief Centralized debug output manager.
 *
 * Wraps Serial.printf with consistent formatting:
 *   [HH:MM:SS][LEVEL] category: message
 *
 * Levels: INFO, WARN, ERR, CRIT
 *
 * Usage:
 *   SerialDebugger::info("Sensor", "Temperature: %.1f°C", temp);
 *   SerialDebugger::warning("Safety", "Voltage low: %.2fV", v);
 */
class SerialDebugger {
public:
    /**
     * @brief Initialize the serial debugger.
     * @param baudRate Serial baud rate (default from config).
     */
    static void begin(unsigned long baudRate = SERIAL_BAUD_RATE) {
        Serial.begin(baudRate);
        while (!Serial && millis() < 3000) {
            // Wait up to 3s for Serial to be ready (USB CDC)
        }
        _bootTime = millis();
        separator();
        info("BOOT", "SEMS Firmware v%s starting...", FIRMWARE_VERSION);
        info("BOOT", "Build: %s %s", BUILD_DATE, BUILD_TIME);
        info("BOOT", "Device: %s", DEVICE_ID);
        info("BOOT", "Free heap: %u bytes", ESP.getFreeHeap());
        separator();
    }

    /**
     * @brief Print a formatted informational message.
     * @param category Source category (e.g., "SENSOR", "RELAY").
     * @param format printf-style format string.
     */
    template<typename... Args>
    static void info(const char* category, const char* format, Args... args) {
        print("INFO", category, format, args...);
    }

    /**
     * @brief Print a formatted warning message.
     */
    template<typename... Args>
    static void warning(const char* category, const char* format, Args... args) {
        print("WARN", category, format, args...);
    }

    /**
     * @brief Print a formatted error message.
     */
    template<typename... Args>
    static void error(const char* category, const char* format, Args... args) {
        print(" ERR", category, format, args...);
    }

    /**
     * @brief Print a formatted critical message.
     */
    template<typename... Args>
    static void critical(const char* category, const char* format, Args... args) {
        print("CRIT", category, format, args...);
        separator();
    }

    /**
     * @brief Print a visual separator line.
     */
    static void separator() {
        Serial.println(F("================================================"));
    }

    /**
     * @brief Feed the ESP32 watchdog and optionally print a heartbeat.
     * @param showHeartbeat If true, print periodic status info.
     */
    static void heartbeat(bool showHeartbeat = false) {
        esp_task_wdt_reset();  // Reset hardware watchdog

        if (showHeartbeat) {
            static unsigned long lastBeat = 0;
            if (millis() - lastBeat >= 5000) {
                lastBeat = millis();
                info("HEART", "Uptime: %lus, Heap: %u, RSSI: %ddBm",
                     millis() / 1000,
                     ESP.getFreeHeap(),
                     WiFi.RSSI());
            }
        }
    }

    /**
     * @brief Get uptime string in human-readable format.
     * @return String like "1d 5h 30m 15s"
     */
    static String uptimeString() {
        unsigned long totalSec = millis() / 1000;
        unsigned long days = totalSec / 86400;
        unsigned long hours = (totalSec % 86400) / 3600;
        unsigned long minutes = (totalSec % 3600) / 60;
        unsigned long seconds = totalSec % 60;

        char buf[32];
        snprintf(buf, sizeof(buf), "%lud %02luh %02lum %02lus",
                 days, hours, minutes, seconds);
        return String(buf);
    }

private:
    static unsigned long _bootTime;

    /**
     * @brief Core print method with timestamp and level prefix.
     */
    template<typename... Args>
    static void print(const char* level, const char* category,
                      const char* format, Args... args) {
#if DEBUG_ENABLED
        char timestamp[12];
        unsigned long elapsed = (millis() - _bootTime) / 1000;
        snprintf(timestamp, sizeof(timestamp), "%02lu:%02lu:%02lu",
                 (elapsed / 3600) % 24,
                 (elapsed / 60) % 60,
                 elapsed % 60);

        Serial.printf("[%s][%-4s] %s: ", timestamp, level, category);
        Serial.printf(format, args...);
        Serial.println();
#endif
    }

    // Prevent instantiation
    SerialDebugger() = delete;
};

#endif // SEMS_SERIAL_DEBUGGER_H
