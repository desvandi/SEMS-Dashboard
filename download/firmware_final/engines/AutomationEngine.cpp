/**
 * @file AutomationEngine.cpp
 * @brief Automation rule evaluation engine implementation
 */

#include "AutomationEngine.h"
#include "../utils/SerialDebugger.h"

// ============================================================================
// CONSTRUCTOR
// ============================================================================

AutomationEngine::AutomationEngine()
    : _ruleCount(0),
      _initialized(false),
      _stats({}) {
    memset(_rules, 0, sizeof(_rules));
    memset(&_stats, 0, sizeof(_stats));
}

// ============================================================================
// INITIALIZATION
// ============================================================================

void AutomationEngine::begin() {
    DBG_AUTO("AutomationEngine: Initialized (max %d rules)", MAX_RULES);
    _initialized = true;

    // Add some default example rules
    AutomationRule rule1;
    strncpy(rule1.name, "Night Mode Lights", sizeof(rule1.name) - 1);
    rule1.enabled = true;
    strncpy(rule1.logic, "AND", sizeof(rule1.logic) - 1);

    // Condition: hour >= 18 (6 PM)
    strncpy(rule1.conditions[0].sensor, "time_hour", sizeof(rule1.conditions[0].sensor) - 1);
    strncpy(rule1.conditions[0].op, ">=", sizeof(rule1.conditions[0].op) - 1);
    rule1.conditions[0].value = 18;
    rule1.conditions[0].boolValue = false;

    // Condition: hour < 6
    strncpy(rule1.conditions[1].sensor, "time_hour", sizeof(rule1.conditions[1].sensor) - 1);
    strncpy(rule1.conditions[1].op, "<", sizeof(rule1.conditions[1].op) - 1);
    rule1.conditions[1].value = 6;
    rule1.conditions[1].boolValue = false;

    // Condition: PIR1 motion
    strncpy(rule1.conditions[2].sensor, "pir1", sizeof(rule1.conditions[2].sensor) - 1);
    strncpy(rule1.conditions[2].op, "==", sizeof(rule1.conditions[2].op) - 1);
    rule1.conditions[2].value = 1;
    rule1.conditions[2].boolValue = true;

    rule1.conditionCount = 3;

    // Action: Turn on relay CH1 (lights)
    strncpy(rule1.actions[0].type, "relay", sizeof(rule1.actions[0].type) - 1);
    rule1.actions[0].target = 0;  // CH1
    rule1.actions[0].intValue = 1;
    rule1.actions[0].boolValue = true;

    rule1.actionCount = 1;
    rule1.cooldownMs = 60000;  // 1 minute cooldown
    rule1.lastTriggered = 0;
    rule1.lastResult = false;

    addRule(rule1);
    DBG_AUTO("Added default rule: 'Night Mode Lights'");
}

// ============================================================================
// MAIN LOOP
// ============================================================================

void AutomationEngine::loop(const SensorSystemState& sensorState,
                            const SOC_Calculator& soc,
                            void (*setRelay)(int, bool),
                            void (*setMOSFET)(int, uint8_t)) {
    if (!_initialized) return;

    unsigned long evalStart = millis();
    _stats.activeRules = 0;

    for (int r = 0; r < _ruleCount; r++) {
        AutomationRule& rule = _rules[r];

        if (!rule.enabled) continue;
        _stats.activeRules++;

        _stats.totalEvaluations++;

        // -------------------------------------------------------------------
        // Evaluate conditions based on logic (AND/OR)
        // -------------------------------------------------------------------
        bool result;
        if (strncmp(rule.logic, "OR", 2) == 0) {
            // OR logic: any condition true = rule true
            result = false;
            for (int c = 0; c < rule.conditionCount; c++) {
                if (evaluateCondition(rule.conditions[c], sensorState, soc)) {
                    result = true;
                    break;
                }
            }
        } else {
            // AND logic (default): all conditions must be true
            result = true;
            for (int c = 0; c < rule.conditionCount; c++) {
                if (!evaluateCondition(rule.conditions[c], sensorState, soc)) {
                    result = false;
                    break;
                }
            }
        }

        rule.lastResult = result;
        rule.lastEvalTime = millis();

        // -------------------------------------------------------------------
        // Execute actions if conditions are met and cooldown has passed
        // -------------------------------------------------------------------
        if (result && rule.actionCount > 0) {
            unsigned long now = millis();
            if (now - rule.lastTriggered >= rule.cooldownMs) {
                executeActions(rule, setRelay, setMOSFET);
                rule.lastTriggered = now;
                _stats.totalTriggers++;
                DBG_AUTO("TRIGGERED: '%s'", rule.name);
            }
        }
    }

    _stats.lastEvalDurationMs = millis() - evalStart;
}

// ============================================================================
// CONDITION EVALUATION
// ============================================================================

bool AutomationEngine::evaluateCondition(const AutomationCondition& cond,
                                          const SensorSystemState& sensorState,
                                          const SOC_Calculator& soc) {
    float actual = getSensorValue(cond.sensor, sensorState, soc);

    if (isnan(actual)) {
        // Try boolean comparison for PIR sensors
        if (strncmp(cond.sensor, "pir", 3) == 0) {
            int pirIdx = cond.sensor[3] - '1';
            if (pirIdx >= 0 && pirIdx < PIR_COUNT) {
                return compare(sensorState.pirStates[pirIdx] ? 1.0f : 0.0f,
                              cond.op, cond.boolValue ? 1.0f : 0.0f);
            }
        }
        return false;
    }

    return compare(actual, cond.op, cond.value);
}

float AutomationEngine::getSensorValue(const char* sensorName,
                                        const SensorSystemState& state,
                                        const SOC_Calculator& soc) {
    // Battery
    if (strcmp(sensorName, "battery_v") == 0) return state.batteryVoltage;
    if (strcmp(sensorName, "battery_i") == 0) return state.batteryCurrent;
    if (strcmp(sensorName, "battery_p") == 0) return state.batteryPower;

    // SOC
    if (strcmp(sensorName, "soc") == 0) return soc.getSOC();

    // Inverter
    if (strcmp(sensorName, "inverter_i") == 0) return state.inverterCurrent;

    // Environment
    if (strcmp(sensorName, "temp") == 0) return state.roomTemp;
    if (strcmp(sensorName, "humidity") == 0) return state.roomHumidity;

    // Cell voltages (cell1-cell8)
    if (strncmp(sensorName, "cell", 4) == 0 && strlen(sensorName) >= 5) {
        int cellNum = atoi(sensorName + 4);
        if (cellNum >= 1 && cellNum <= NUM_CELLS) {
            return state.cellVoltages[cellNum - 1];
        }
    }

    // PIR states (pir1-pir4)
    if (strncmp(sensorName, "pir", 3) == 0 && strlen(sensorName) >= 4) {
        int pirNum = sensorName[3] - '0';
        if (pirNum >= 1 && pirNum <= PIR_COUNT) {
            return state.pirStates[pirNum - 1] ? 1.0f : 0.0f;
        }
    }

    // Time
    if (strcmp(sensorName, "time_hour") == 0) return (float)state.hour;
    if (strcmp(sensorName, "time_min") == 0) return (float)state.minute;
    if (strcmp(sensorName, "time_dow") == 0) return (float)state.dayOfWeek;

    // Cell stats
    if (strcmp(sensorName, "cell_min") == 0) return state.minCellV;
    if (strcmp(sensorName, "cell_max") == 0) return state.maxCellV;
    if (strcmp(sensorName, "cell_diff") == 0) return state.cellDiff;

    // System
    if (strcmp(sensorName, "wifi_rssi") == 0) return (float)state.wifiRSSI;
    if (strcmp(sensorName, "free_heap") == 0) return (float)state.freeHeap;
    if (strcmp(sensorName, "uptime") == 0) return (float)state.uptimeSeconds;

    return NAN;  // Unknown sensor
}

bool AutomationEngine::compare(float actual, const char* op, float expected) {
    if (strcmp(op, COND_OP_GT) == 0) return actual > expected;
    if (strcmp(op, COND_OP_LT) == 0) return actual < expected;
    if (strcmp(op, COND_OP_EQ) == 0) return fabsf(actual - expected) < 0.05f;
    if (strcmp(op, COND_OP_GTE) == 0) return actual >= expected;
    if (strcmp(op, COND_OP_LTE) == 0) return actual <= expected;
    if (strcmp(op, COND_OP_NE) == 0) return fabsf(actual - expected) >= 0.05f;
    return false;
}

// ============================================================================
// ACTION EXECUTION
// ============================================================================

void AutomationEngine::executeActions(const AutomationRule& rule,
                                       void (*setRelay)(int, bool),
                                       void (*setMOSFET)(int, uint8_t)) {
    for (int a = 0; a < rule.actionCount; a++) {
        const AutomationAction& action = rule.actions[a];

        if (strcmp(action.type, "relay") == 0) {
            if (setRelay != nullptr && action.target >= 0 && action.target < NUM_RELAYS) {
                setRelay(action.target, action.boolValue);
                DBG_AUTO("  Action: Relay CH%d -> %s",
                         action.target + 1, action.boolValue ? "ON" : "OFF");
            }
        } else if (strcmp(action.type, "mosfet") == 0) {
            if (setMOSFET != nullptr && action.target >= 0 && action.target < NUM_MOSFETS) {
                setMOSFET(action.target, (uint8_t)action.intValue);
                DBG_AUTO("  Action: MOSFET %d -> PWM %d",
                         action.target + 1, action.intValue);
            }
        }
    }
}

// ============================================================================
// RULE MANAGEMENT
// ============================================================================

bool AutomationEngine::addRule(const AutomationRule& rule) {
    if (_ruleCount >= MAX_RULES) {
        DBG_AUTO("Cannot add rule '%s' - max rules reached (%d)", rule.name, MAX_RULES);
        return false;
    }

    _rules[_ruleCount] = rule;
    _ruleCount++;
    DBG_AUTO("Rule added: '%s' (%d conditions, %d actions)",
             rule.name, rule.conditionCount, rule.actionCount);
    return true;
}

bool AutomationEngine::addRuleFromJSON(const char* json) {
    // TODO: Implement full conditions and actions JSON parsing.
    // Currently only parses name, enabled, logic, and cooldown_ms.
    // The conditions[] and actions[] arrays are not populated from JSON.
    String j = String(json);

    AutomationRule rule;
    memset(&rule, 0, sizeof(rule));

    // Parse name
    String name = parseString(j, "name");
    strncpy(rule.name, name.c_str(), sizeof(rule.name) - 1);

    // Parse enabled
    rule.enabled = parseBool(j, "enabled");

    // Parse logic
    String logic = parseString(j, "logic");
    strncpy(rule.logic, logic.c_str(), sizeof(rule.logic) - 1);

    // Parse conditions (simplified - expecting flat conditions array)
    // Note: Full JSON array parsing would need ArduinoJson for complex cases
    // This handles a simplified format

    // Default cooldown
    int cd = parseInt(j, "cooldown_ms");
    rule.cooldownMs = (cd > 0) ? (unsigned long)cd : 30000;

    // Add the rule even if conditions are empty (will be populated later)
    return addRule(rule);
}

bool AutomationEngine::setRuleEnabled(const char* name, bool enabled) {
    for (int i = 0; i < _ruleCount; i++) {
        if (strcmp(_rules[i].name, name) == 0) {
            _rules[i].enabled = enabled;
            DBG_AUTO("Rule '%s' %s", name, enabled ? "ENABLED" : "DISABLED");
            return true;
        }
    }
    return false;
}

bool AutomationEngine::removeRule(const char* name) {
    for (int i = 0; i < _ruleCount; i++) {
        if (strcmp(_rules[i].name, name) == 0) {
            // Shift remaining rules down
            for (int j = i; j < _ruleCount - 1; j++) {
                _rules[j] = _rules[j + 1];
            }
            _ruleCount--;
            DBG_AUTO("Rule '%s' removed", name);
            return true;
        }
    }
    return false;
}

int AutomationEngine::getRuleCount() const {
    return _ruleCount;
}

const AutomationStats& AutomationEngine::getStats() const {
    return _stats;
}

// ============================================================================
// SIMPLE JSON PARSERS
// ============================================================================

static String extractJStr(const String& json, const char* key) {
    String searchKey = String("\"") + key + "\":";
    int keyPos = json.indexOf(searchKey);
    if (keyPos < 0) return "";

    int valueStart = keyPos + searchKey.length();
    while (valueStart < (int)json.length() && json[valueStart] == ' ') valueStart++;

    if (json[valueStart] == '"') {
        valueStart++;
        String result;
        while (valueStart < (int)json.length()) {
            char c = json[valueStart];
            if (c == '"') break;
            result += c;
            valueStart++;
        }
        return result;
    }

    // Non-string value
    String result;
    while (valueStart < (int)json.length()) {
        char c = json[valueStart];
        if (c == ',' || c == '}' || c == ']' || c == '\n') break;
        result += c;
        valueStart++;
    }
    return result.trim();
}

float AutomationEngine::parseFloat(const String& json, const char* key) {
    String val = extractJStr(json, key);
    return val.toFloat();
}

int AutomationEngine::parseInt(const String& json, const char* key) {
    String val = extractJStr(json, key);
    return val.toInt();
}

bool AutomationEngine::parseBool(const String& json, const char* key) {
    String val = extractJStr(json, key);
    val.toLowerCase();
    return (val == "true" || val == "1");
}

String AutomationEngine::parseString(const String& json, const char* key) {
    return extractJStr(json, key);
}
