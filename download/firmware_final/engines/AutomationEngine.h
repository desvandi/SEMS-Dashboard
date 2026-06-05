/**
 * @file AutomationEngine.h
 * @brief JSON-based automation rule evaluation engine
 *
 * Evaluates user-defined automation rules against sensor data.
 * Rules are JSON objects with conditions and actions.
 *
 * Rule format:
 * {
 *   "name": "Rule Name",
 *   "enabled": true,
 *   "logic": "AND",          // AND or OR between conditions
 *   "conditions": [
 *     {"sensor": "soc", "op": "<", "value": 20},
 *     {"sensor": "pir1", "op": "==", "value": true}
 *   ],
 *   "actions": [
 *     {"type": "relay", "target": 5, "value": false},
 *     {"type": "mosfet", "target": 0, "value": 128}
 *   ]
 * }
 *
 * Supported sensors: soc, battery_v, battery_i, inverter_i, temp, humidity,
 *                   pir1-pir4, cell1-cell8, relay1-relay13, time_hour, time_min
 * Supported operators: >, <, ==, >=, <=, !=
 * Supported actions: relay (on/off), mosfet (pwm value)
 */

#ifndef SEMS_AUTOMATION_ENGINE_H
#define SEMS_AUTOMATION_ENGINE_H

#include <Arduino.h>
#include "../sensors/SensorEngine.h"
#include "../utils/SOC_Calculator.h"
#include "config.h"

/**
 * @struct AutomationCondition
 * @brief A single condition in an automation rule.
 */
struct AutomationCondition {
    char sensor[24];    // Sensor identifier
    char op[4];         // Comparison operator
    float value;        // Threshold value
    bool boolValue;     // For boolean comparisons
};

/**
 * @struct AutomationAction
 * @brief An action to execute when all conditions are met.
 */
struct AutomationAction {
    char type[12];      // Action type: "relay" or "mosfet"
    int target;         // Target index (0-12 for relay, 0-3 for mosfet)
    int intValue;       // Integer value (0/1 for relay, 0-255 for mosfet)
    bool boolValue;     // Boolean value for relay on/off
};

/**
 * @struct AutomationRule
 * @brief A complete automation rule with conditions and actions.
 */
struct AutomationRule {
    char name[32];                  // Rule name
    bool enabled;                   // Rule enabled state
    char logic[4];                  // Logic operator: "AND" or "OR"
    AutomationCondition conditions[RULE_CONDITIONS_MAX];
    int conditionCount;
    AutomationAction actions[RULE_ACTIONS_MAX];
    int actionCount;
    unsigned long lastTriggered;    // millis() of last trigger
    bool lastResult;                // Last evaluation result
    unsigned long cooldownMs;       // Cooldown between triggers
    unsigned long lastEvalTime;     // millis() of last evaluation
};

/**
 * @struct AutomationStats
 * @brief Statistics about automation rule evaluation.
 */
struct AutomationStats {
    uint32_t totalEvaluations;      // Total rule evaluations
    uint32_t totalTriggers;         // Total rule triggers
    uint32_t activeRules;           // Number of enabled rules
    uint32_t lastEvalDurationMs;    // Last evaluation cycle duration
};

/**
 * @class AutomationEngine
 * @brief Evaluates automation rules against sensor data.
 */
class AutomationEngine {
public:
    AutomationEngine();

    /**
     * @brief Initialize the automation engine.
     */
    void begin();

    /**
     * @brief Main loop - evaluate all enabled rules.
     * @param sensorState Current sensor system state.
     * @param soc SOC calculator reference.
     * @param setRelay Callback to set relay state (index, state).
     * @param setMOSFET Callback to set MOSFET PWM (index, value).
     */
    void loop(const SensorSystemState& sensorState,
              const SOC_Calculator& soc,
              void (*setRelay)(int, bool),
              void (*setMOSFET)(int, uint8_t));

    /**
     * @brief Add a rule from its components.
     * @param rule Rule structure to add.
     * @return true if added successfully (within MAX_RULES limit).
     */
    bool addRule(const AutomationRule& rule);

    /**
     * @brief Parse and add a rule from JSON string.
     * @param json JSON string representing the rule.
     * @return true if parsed and added successfully.
     */
    bool addRuleFromJSON(const char* json);

    /**
     * @brief Enable or disable a rule by name.
     * @param name Rule name.
     * @param enabled true to enable.
     * @return true if rule was found and updated.
     */
    bool setRuleEnabled(const char* name, bool enabled);

    /**
     * @brief Remove a rule by name.
     * @param name Rule name to remove.
     * @return true if found and removed.
     */
    bool removeRule(const char* name);

    /**
     * @brief Get rule count.
     * @return Number of rules (enabled + disabled).
     */
    int getRuleCount() const;

    /**
     * @brief Get automation statistics.
     * @return Const reference to AutomationStats.
     */
    const AutomationStats& getStats() const;

private:
    AutomationRule _rules[MAX_RULES]; // Rule storage
    int _ruleCount;                  // Number of active rules
    bool _initialized;
    AutomationStats _stats;

    /**
     * @brief Evaluate a single condition against sensor data.
     * @param cond Condition to evaluate.
     * @param sensorState Current sensor state.
     * @param soc SOC calculator.
     * @return true if condition is met.
     */
    bool evaluateCondition(const AutomationCondition& cond,
                           const SensorSystemState& sensorState,
                           const SOC_Calculator& soc);

    /**
     * @brief Get a sensor value by name.
     * @param sensorName Sensor identifier.
     * @param sensorState Current sensor state.
     * @param soc SOC calculator.
     * @return Sensor value as float, or NAN if not found.
     */
    float getSensorValue(const char* sensorName,
                         const SensorSystemState& sensorState,
                         const SOC_Calculator& soc);

    /**
     * @brief Compare a value using an operator.
     * @param actual Actual value.
     * @param op Comparison operator.
     * @param expected Expected value.
     * @return true if comparison passes.
     */
    bool compare(float actual, const char* op, float expected);

    /**
     * @brief Execute all actions in a rule.
     */
    void executeActions(const AutomationRule& rule,
                        void (*setRelay)(int, bool),
                        void (*setMOSFET)(int, uint8_t));

    /**
     * @brief Parse a simple JSON value (manual parser).
     * Used to avoid requiring ArduinoJson as a dependency.
     */
    static float parseFloat(const String& json, const char* key);
    static int parseInt(const String& json, const char* key);
    static bool parseBool(const String& json, const char* key);
    static String parseString(const String& json, const char* key);
};

#endif // SEMS_AUTOMATION_ENGINE_H
