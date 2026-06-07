#ifndef NON_BLOCKING_TIMER_H
#define NON_BLOCKING_TIMER_H

#include <Arduino.h>

// ============================================================================
// NonBlockingTimer - Header-only replacement for delay()
// Uses millis() for timing, safe for FreeRTOS and watchdog.
// Include this header in any .cpp file that needs timer functionality.
// ============================================================================

class NonBlockingTimer {
private:
    unsigned long _intervalMs;
    unsigned long _lastTrigger;
    bool _autoReset;
    bool _enabled;

public:
    NonBlockingTimer(unsigned long intervalMs, bool autoReset = true)
        : _intervalMs(intervalMs)
        , _lastTrigger(0)
        , _autoReset(autoReset)
        , _enabled(true)
    {}

    // Check if timer has expired
    bool check() {
        if (!_enabled) return false;
        if (millis() - _lastTrigger >= _intervalMs) {
            if (_autoReset) {
                _lastTrigger = millis();
            }
            return true;
        }
        return false;
    }

    // Force trigger now and reset
    void reset() {
        _lastTrigger = millis();
    }

    // Change interval
    void setInterval(unsigned long intervalMs) {
        _intervalMs = intervalMs;
    }

    // Get current interval
    unsigned long getInterval() const {
        return _intervalMs;
    }

    // Get time since last trigger
    unsigned long elapsed() const {
        return millis() - _lastTrigger;
    }

    // Enable/disable timer.
    // Note: Enabling resets the timing baseline so the first check() after
    // enable() will not fire immediately unless the full interval has elapsed.
    void enable(bool state = true) {
        _enabled = state;
        if (state) {
            _lastTrigger = millis();
        }
    }

    bool isEnabled() const {
        return _enabled;
    }
};

#endif // NON_BLOCKING_TIMER_H
