/**
 * @file LoadSheddingEngine.h
 * @brief 4-tier priority load management engine
 *
 * Implements progressive load shedding based on battery SOC and conditions:
 *
 *   Tier 0 (Critical):  NEVER shed - lights, security, communication
 *   Tier 1 (Essential):  Shed only below SHED_SOC_CRITICAL (<15%)
 *   Tier 2 (Standard):   Shed below SHED_SOC_LOW (<25%)
 *   Tier 3 (Comfort):    Shed below SHED_SOC_NORMAL (<35%)
 *
 * Features:
 *   - Hysteresis to prevent rapid on/off cycling
 *   - Automatic load restoration as SOC recovers
 *   - Configurable thresholds from remote config
 *   - Event logging for load state changes
 *   - Override capability for manual control
 */

#ifndef SEMS_LOAD_SHEDDING_ENGINE_H
#define SEMS_LOAD_SHEDDING_ENGINE_H

#include <Arduino.h>
#include "config.h"

/**
 * @enum LoadTier
 * @brief Priority tiers for load classification.
 */
enum LoadTier {
    TIER_CRITICAL = 0,   // Never shed
    TIER_ESSENTIAL = 1,  // Shed at critical SOC only
    TIER_STANDARD = 2,   // Shed at low SOC
    TIER_COMFORT = 3     // Shed at normal-low SOC
};

/**
 * @struct LoadAssignment
 * @brief Maps each relay to a load tier.
 */
struct LoadAssignment {
    int relayIndex;       // Relay channel (0-12)
    LoadTier tier;        // Priority tier
    const char* name;     // Human-readable load name
};

/**
 * @struct SheddingState
 * @brief Current state of load shedding.
 */
struct SheddingState {
    bool isActive;                // true if any load is currently shed
    LoadTier activeTier;          // Highest tier being shed
    float socPercent;             // SOC at last evaluation
    unsigned long lastEvalTime;   // millis() of last evaluation
    int shedRelays[NUM_RELAYS];   // Which relays were shed by this engine (0/1)
    int restoredCount;            // Number of relays restored in last cycle
    int sheddedCount;             // Number of relays shed in last cycle
};

/**
 * @class LoadSheddingEngine
 * @brief Manages 4-tier load shedding based on battery SOC.
 */
class LoadSheddingEngine {
public:
    LoadSheddingEngine();

    /**
     * @brief Initialize the load shedding engine.
     *
     * Sets up default tier assignments for each relay.
     * Customize for your specific loads.
     */
    void begin();

    /**
     * @brief Main loop - evaluate shedding conditions.
     * @param socPercent Current battery SOC percentage.
     * @param setRelay Callback to control relay state (index, state).
     */
    void loop(float socPercent, void (*setRelay)(int, bool));

    /**
     * @brief Get the current shedding state.
     * @return Const reference to SheddingState.
     */
    const SheddingState& getState() const;

    /**
     * @brief Check if load shedding is currently active.
     * @return true if any loads are being shed.
     */
    bool isActive() const;

    /**
     * @brief Set a relay's tier assignment.
     * @param relayIndex Relay number (0-12).
     * @param tier Priority tier.
     * @param name Human-readable name.
     */
    void setLoadTier(int relayIndex, LoadTier tier, const char* name);

    /**
     * @brief Update thresholds from remote config.
     * @param critical Critical SOC threshold.
     * @param low Low SOC threshold.
     * @param normal Normal SOC threshold.
     * @param hysteresis Restoration hysteresis.
     */
    void updateThresholds(float critical, float low, float normal, float hysteresis);

    /**
     * @brief Force all loads on (override shedding).
     */
    void forceAllOn();

    /**
     * @brief Get the tier assignment for a relay.
     * @param relayIndex Relay number (0-12).
     * @return LoadTier for the specified relay.
     */
    LoadTier getLoadTier(int relayIndex) const;

private:
    SheddingState _state;          // Current shedding state
    LoadAssignment _loads[NUM_RELAYS]; // Load tier assignments
    bool _initialized;
    bool _overrideActive;          // Manual override active

    // Thresholds (from config or remote)
    float _socCritical;            // SOC% for Tier 1 shedding
    float _socLow;                 // SOC% for Tier 2 shedding
    float _socNormal;              // SOC% for Tier 3 shedding
    float _hysteresis;             // Hysteresis band

    /**
     * @brief Evaluate whether a tier should be shed or restored.
     * @param tier Tier to evaluate.
     * @param socPercent Current SOC.
     * @return true if loads in this tier should be shed.
     */
    bool shouldShed(LoadTier tier, float socPercent);

    /**
     * @brief Evaluate whether a tier should be restored.
     * @param tier Tier to evaluate.
     * @param socPercent Current SOC.
     * @return true if loads in this tier should be restored.
     */
    bool shouldRestore(LoadTier tier, float socPercent);
};

#endif // SEMS_LOAD_SHEDDING_ENGINE_H
