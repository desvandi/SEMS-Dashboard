/**
 * @file LoadSheddingEngine.cpp
 * @brief Load shedding engine implementation
 */

#include "LoadSheddingEngine.h"
#include "../utils/SerialDebugger.h"

// ============================================================================
// CONSTRUCTOR
// ============================================================================

LoadSheddingEngine::LoadSheddingEngine()
    : _state({}),
      _initialized(false),
      _overrideActive(false),
      _socCritical(SHED_SOC_CRITICAL),
      _socLow(SHED_SOC_LOW),
      _socNormal(SHED_SOC_NORMAL),
      _hysteresis(SHED_RESTORE_HYSTERESIS) {
    memset(&_state, 0, sizeof(_state));
    memset(_state.shedRelays, 0, sizeof(_state.shedRelays));
}

// ============================================================================
// INITIALIZATION
// ============================================================================

void LoadSheddingEngine::begin() {
    DBG_SHED("LoadShedding: Initializing 4-tier load management...");

    // -----------------------------------------------------------------------
    // DEFAULT LOAD TIER ASSIGNMENTS
    // Customize these based on your actual wiring!
    // -----------------------------------------------------------------------

    // Tier 0: CRITICAL - Never shed
    _loads[0]  = {0,  TIER_CRITICAL,  "Security System"};
    _loads[1]  = {1,  TIER_CRITICAL,  "WiFi Router"};
    _loads[2]  = {2,  TIER_CRITICAL,  "Main Lights"};

    // Tier 1: ESSENTIAL - Shed only at critical SOC
    _loads[3]  = {3,  TIER_ESSENTIAL,  "Refrigerator"};
    _loads[4]  = {4,  TIER_ESSENTIAL,  "Phone Charger"};
    _loads[5]  = {5,  TIER_ESSENTIAL,  "Ceiling Fan"};

    // Tier 2: STANDARD - Shed at low SOC
    _loads[6]  = {6,  TIER_STANDARD,   "TV/Media"};
    _loads[7]  = {7,  TIER_STANDARD,   "Computer"};
    _loads[8]  = {8,  TIER_STANDARD,   "Washing Machine"};

    // Tier 3: COMFORT - Shed at normal-low SOC
    _loads[9]  = {9,  TIER_COMFORT,    "Water Heater"};
    _loads[10] = {10, TIER_COMFORT,    "Air Conditioner"};
    _loads[11] = {11, TIER_COMFORT,    "Outdoor Lights"};
    _loads[12] = {12, TIER_COMFORT,    "Misc Load"};

    // Fill remaining slots if NUM_RELAYS > 13
    for (int i = 13; i < NUM_RELAYS; i++) {
        _loads[i] = {i, TIER_COMFORT, "Unassigned"};
    }

    _initialized = true;
    _state.activeTier = TIER_CRITICAL;  // Nothing being shed initially

    // Print tier assignments
    for (int i = 0; i < NUM_RELAYS; i++) {
        DBG_SHED("  CH%d: Tier%d - %s", _loads[i].relayIndex + 1,
                 _loads[i].tier, _loads[i].name);
    }

    DBG_SHED("LoadShedding: Thresholds: Critical=%.1f%%, Low=%.1f%%, Normal=%.1f%%",
             _socCritical, _socLow, _socNormal);
}

// ============================================================================
// MAIN LOOP
// ============================================================================

void LoadSheddingEngine::loop(float socPercent, void (*setRelay)(int, bool)) {
    if (!_initialized || _overrideActive) return;

    _state.socPercent = socPercent;
    _state.lastEvalTime = millis();
    _state.sheddedCount = 0;
    _state.restoredCount = 0;

    bool anyShed = false;
    LoadTier highestShed = TIER_CRITICAL;

    // -----------------------------------------------------------------------
    // Evaluate each relay's tier against current SOC
    // Process from highest tier (Comfort=3) to lowest (Critical=0)
    // so we restore comfort loads first when SOC recovers
    // -----------------------------------------------------------------------
    for (int tier = TIER_COMFORT; tier >= TIER_CRITICAL; tier--) {
        bool shed = shouldShed((LoadTier)tier, socPercent);
        bool restore = shouldRestore((LoadTier)tier, socPercent);

        for (int i = 0; i < NUM_RELAYS; i++) {
            if (_loads[i].tier != (LoadTier)tier) continue;

            if (shed && !_state.shedRelays[i]) {
                // Shed this load
                if (setRelay != nullptr) setRelay(i, false);  // Turn OFF
                _state.shedRelays[i] = 1;
                _state.sheddedCount++;
                anyShed = true;
                DBG_SHED("SHED: CH%d (%s) - SOC=%.1f%% (Tier%d)",
                         i + 1, _loads[i].name, socPercent, tier);
            } else if (restore && _state.shedRelays[i]) {
                // Restore this load
                if (setRelay != nullptr) setRelay(i, true);  // Turn ON
                _state.shedRelays[i] = 0;
                _state.restoredCount++;
                DBG_SHED("RESTORE: CH%d (%s) - SOC=%.1f%% (Tier%d)",
                         i + 1, _loads[i].name, socPercent, tier);
            }

            if (_state.shedRelays[i] && (LoadTier)tier > highestShed) {
                highestShed = (LoadTier)tier;
            }
        }
    }

    _state.isActive = anyShed;
    _state.activeTier = highestShed;
}

// ============================================================================
// SHEDDING LOGIC
// ============================================================================

bool LoadSheddingEngine::shouldShed(LoadTier tier, float socPercent) {
    switch (tier) {
        case TIER_CRITICAL:
            return false;  // NEVER shed critical loads

        case TIER_ESSENTIAL:
            return socPercent < _socCritical;

        case TIER_STANDARD:
            return socPercent < _socLow;

        case TIER_COMFORT:
            return socPercent < _socNormal;

        default:
            return false;
    }
}

bool LoadSheddingEngine::shouldRestore(LoadTier tier, float socPercent) {
    // Restore at threshold + hysteresis to prevent oscillation
    switch (tier) {
        case TIER_CRITICAL:
            return false;

        case TIER_ESSENTIAL:
            return socPercent >= (_socCritical + _hysteresis);

        case TIER_STANDARD:
            return socPercent >= (_socLow + _hysteresis);

        case TIER_COMFORT:
            return socPercent >= (_socNormal + _hysteresis);

        default:
            return false;
    }
}

// ============================================================================
// CONFIGURATION
// ============================================================================

void LoadSheddingEngine::setLoadTier(int relayIndex, LoadTier tier, const char* name) {
    if (relayIndex >= 0 && relayIndex < NUM_RELAYS) {
        _loads[relayIndex].tier = tier;
        if (name != nullptr) _loads[relayIndex].name = name;
    }
}

void LoadSheddingEngine::updateThresholds(float critical, float low,
                                           float normal, float hysteresis) {
    _socCritical = critical;
    _socLow = low;
    _socNormal = normal;
    _hysteresis = hysteresis;
    DBG_SHED("LoadShedding: Thresholds updated: C=%.1f%%, L=%.1f%%, N=%.1f%%, H=%.1f%%",
             critical, low, normal, hysteresis);
}

void LoadSheddingEngine::forceAllOn() {
    _overrideActive = true;
    memset(_state.shedRelays, 0, sizeof(_state.shedRelays));
    _state.isActive = false;
    DBG_SHED("LoadShedding: OVERRIDE - All loads forced ON");
}

LoadTier LoadSheddingEngine::getLoadTier(int relayIndex) const {
    if (relayIndex >= 0 && relayIndex < NUM_RELAYS) return _loads[relayIndex].tier;
    return TIER_COMFORT;
}

const SheddingState& LoadSheddingEngine::getState() const {
    return _state;
}

bool LoadSheddingEngine::isActive() const {
    return _state.isActive;
}
