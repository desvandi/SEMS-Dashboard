/**
 * @file ScheduleEngine.h
 * @brief RTC-based event scheduling engine - Stub header
 *
 * NOTE: This header defines the ScheduleEngine class interface, but the
 * actual schedule evaluation logic for the .ino firmware lives in the
 * scheduleEngineLoop() function in SEMS_Firmware.ino. This class-based
 * engine is used by the modular engine architecture.
 *
 * Manages time-based events using the DS3231 RTC:
 *   - One-time events (fire once at specific date/time)
 *   - Daily recurring events (every day at specified time)
 *   - Weekly recurring events (specific day + time)
 *   - Timer events (countdown from trigger)
 *
 * Schedule format:
 * {
 *   "name": "Morning Lights",
 *   "enabled": true,
 *   "type": "daily",           // one_time, daily, weekly
 *   "hour": 6,
 *   "minute": 0,
 *   "day_of_week": -1,         // 0=Sun..6=Sat, -1=any
 *   "actions": [
 *     {"type": "relay", "target": 0, "value": true}
 *   ],
 *   "last_executed": 0
 * }
 */

#ifndef SEMS_SCHEDULE_ENGINE_H
#define SEMS_SCHEDULE_ENGINE_H

#include <Arduino.h>
#include "../sensors/RTCManager.h"
#include "config.h"

/**
 * @enum ScheduleType
 * @brief Types of scheduled events.
 */
enum ScheduleType {
    SCHED_ONETIME = SCHEDULE_RECUR_NONE,
    SCHED_DAILY = SCHEDULE_RECUR_DAILY,
    SCHED_WEEKLY = SCHEDULE_RECUR_WEEKLY
};

/**
 * @struct ScheduleAction
 * @brief An action to execute when a schedule fires.
 */
struct ScheduleAction {
    char type[12];      // "relay" or "mosfet"
    int target;         // Target index
    int intValue;       // Value (0/1 for relay, 0-255 for mosfet)
    bool boolValue;     // Boolean value
};

/**
 * @struct ScheduleEvent
 * @brief A scheduled event with timing and actions.
 */
struct ScheduleEvent {
    char name[32];              // Schedule name
    bool enabled;               // Schedule enabled state
    ScheduleType type;          // One-time, daily, or weekly
    int8_t dayOfWeek;           // Day of week (0=Sun..6=Sat, -1=any)
    uint8_t hour;               // Hour (0-23)
    uint8_t minute;             // Minute (0-59)
    uint32_t fireTimestamp;     // Unix timestamp for one-time events
    ScheduleAction actions[RULE_ACTIONS_MAX]; // Actions to execute
    int actionCount;            // Number of actions
    uint32_t lastExecuted;      // Unix timestamp of last execution
    bool executed;              // Has this event been executed?
};

/**
 * @class ScheduleEngine
 * @brief Manages RTC-based scheduled events.
 */
class ScheduleEngine {
public:
    ScheduleEngine();

    /**
     * @brief Initialize the schedule engine.
     */
    void begin();

    /**
     * @brief Main loop - check and fire scheduled events.
     * @param rtc RTC manager for time checking.
     * @param setRelay Callback to set relay state.
     * @param setMOSFET Callback to set MOSFET PWM.
     */
    void loop(const RTCManager& rtc,
              void (*setRelay)(int, bool),
              void (*setMOSFET)(int, uint8_t));

    /**
     * @brief Add a scheduled event.
     * @param event Event structure to add.
     * @return true if added successfully.
     */
    bool addEvent(const ScheduleEvent& event);

    /**
     * @brief Add a daily schedule.
     * @param name Schedule name.
     * @param hour Hour (0-23).
     * @param minute Minute (0-59).
     * @param target Relay target index.
     * @param state Relay state to set.
     * @return true if added.
     */
    bool addDailySchedule(const char* name, uint8_t hour, uint8_t minute,
                          int target, bool state);

    /**
     * @brief Add a weekly schedule.
     * @param name Schedule name.
     * @param dayOfWeek Day of week (0=Sun..6=Sat).
     * @param hour Hour.
     * @param minute Minute.
     * @param target Relay target index.
     * @param state Relay state.
     * @return true if added.
     */
    bool addWeeklySchedule(const char* name, int8_t dayOfWeek,
                           uint8_t hour, uint8_t minute,
                           int target, bool state);

    /**
     * @brief Enable or disable a schedule by name.
     * @param name Schedule name.
     * @param enabled true to enable.
     * @return true if found and updated.
     */
    bool setEnabled(const char* name, bool enabled);

    /**
     * @brief Remove a schedule by name.
     * @param name Schedule name.
     * @return true if found and removed.
     */
    bool removeEvent(const char* name);

    /**
     * @brief Get event count.
     * @return Number of scheduled events.
     */
    int getEventCount() const;

    /**
     * @brief Check if current time matches a schedule's target time.
     * @param event Schedule event to check.
     * @param rtcData Current RTC data.
     * @return true if event should fire now.
     */
    bool shouldFire(const ScheduleEvent& event, const RTCData& rtcData);

private:
    ScheduleEvent _events[MAX_SCHEDULES]; // Event storage
    int _eventCount;                       // Number of active events
    bool _initialized;

    /**
     * @brief Execute actions for a fired schedule.
     */
    void executeActions(const ScheduleEvent& event,
                        void (*setRelay)(int, bool),
                        void (*setMOSFET)(int, uint8_t));

    /**
     * @brief Check if event was already executed in the current minute.
     */
    bool wasExecutedThisMinute(const ScheduleEvent& event, const RTCData& rtcData);
};

#endif // SEMS_SCHEDULE_ENGINE_H
