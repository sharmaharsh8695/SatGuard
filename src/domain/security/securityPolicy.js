const { COMMAND_TYPES } = require("../commands/commandTypes");
const {
  SUSPICIOUS_BURST_THRESHOLD,
  SUSPICIOUS_BURST_WINDOW_MS,
  SERIOUS_EVENTS_FOR_RESTRICTED,
  SERIOUS_EVENTS_FOR_SAFE_MODE,
} = require("../../config/constants");

const DECISION_LEVELS = Object.freeze({
  ALLOW: "L0",
  WATCH: "L1",
  HOLD: "L2",
  QUARANTINE: "L3",
  RESTRICTED: "L4",
  SAFE_MODE: "L5",
});

const SECURITY_FAILURE_SIGNALS = Object.freeze({
  authentication: {
    type: "AUTHENTICATION_FAILED",
    severity: "HIGH",
    message: "Operator authentication failed",
  },
  authorization: {
    type: "AUTHORIZATION_FAILED",
    severity: "HIGH",
    message: "Operator is not authorized for this command",
  },
  integrity: {
    type: "INTEGRITY_FAILED",
    severity: "CRITICAL",
    message: "Command integrity verification failed",
  },
  replay: {
    type: "REPLAY_DETECTED",
    severity: "HIGH",
    message: "Command replay detected",
  },
});

const RESTRICTED_ALLOWED_COMMANDS = Object.freeze([
  COMMAND_TYPES.CAMERA_OFF,
  COMMAND_TYPES.HEATER_OFF,
  COMMAND_TYPES.ENTER_SAFE_MODE,
  COMMAND_TYPES.RECOVER,
]);

const operatorSubmissions = new Map();
const restrictedOperators = new Set();

function createSecurityFailureSignal(securityResult) {
  const stage = securityResult.failedStage;
  if (stage === "replay") {
    if (!securityResult.checks.replay.timestampValid) {
      return {
        type: "TIMESTAMP_INVALID",
        severity: "MEDIUM",
        message: securityResult.checks.replay.reason,
      };
    }
    if (securityResult.checks.replay.replayDetected) {
      return { ...SECURITY_FAILURE_SIGNALS.replay, message: securityResult.checks.replay.reason };
    }
  }

  return SECURITY_FAILURE_SIGNALS[stage]
    ? { ...SECURITY_FAILURE_SIGNALS[stage], message: securityResult.checks[stage]?.reason ?? SECURITY_FAILURE_SIGNALS[stage].message }
    : {
        type: "COMMAND_VALIDATION_FAILED",
        severity: "MEDIUM",
        message: securityResult.message ?? "Command validation failed",
      };
}

function createOperationalSignals(consequence, planner) {
  const signals = [];
  if (!consequence?.safe) {
    signals.push({
      type: "UNSAFE_CONSEQUENCE",
      severity: "MEDIUM",
      message: consequence?.violations?.[0]?.message ??
        consequence?.executionFailure?.error?.message ??
        "The queued command sequence is unsafe under modeled constraints",
    });
  }
  if (planner?.status === "NO_SAFE_PLAN") {
    signals.push({
      type: "NO_SAFE_PLAN",
      severity: "HIGH",
      message: planner.reason,
    });
  }
  if (planner?.status === "PLANNING_LIMIT_EXCEEDED") {
    signals.push({
      type: "PLANNING_LIMIT_EXCEEDED",
      severity: "MEDIUM",
      message: planner.reason,
    });
  }
  return signals;
}

function recordOperatorSubmission(operatorId, now = Date.now()) {
  if (typeof operatorId !== "string" || operatorId.length === 0) {
    return null;
  }

  const recent = (operatorSubmissions.get(operatorId) ?? [])
    .filter((timestamp) => timestamp > now - SUSPICIOUS_BURST_WINDOW_MS);
  recent.push(now);
  operatorSubmissions.set(operatorId, recent);

  if (recent.length > SUSPICIOUS_BURST_THRESHOLD) {
    return {
      type: "SUSPICIOUS_COMMAND_BURST",
      severity: "LOW",
      message: `Operator submitted more than ${SUSPICIOUS_BURST_THRESHOLD} commands within the monitoring window`,
    };
  }

  return null;
}

function restrictOperator(operatorId) {
  if (typeof operatorId === "string" && operatorId.length > 0) {
    restrictedOperators.add(operatorId);
  }
}

function isOperatorRestricted(operatorId) {
  return restrictedOperators.has(operatorId);
}

function clearPolicyState() {
  operatorSubmissions.clear();
  restrictedOperators.clear();
}

function selectDecision({
  signals,
  currentSeriousEventCount = 0,
  restricted = false,
  commandType,
  consequenceSafe = true,
  safePlanFound = false,
  planningLimitExceeded = false,
}) {
  const hasSignal = (type) => signals.some((signal) => signal.type === type);
  const currentSeriousSignals = signals.filter(isSeriousSignal).length;
  const criticalSecuritySignal = hasSignal("INTEGRITY_FAILED") || hasSignal("REPLAY_DETECTED");

  if (
    criticalSecuritySignal &&
    currentSeriousEventCount >= SERIOUS_EVENTS_FOR_SAFE_MODE
  ) {
    return decision(
      "SAFE_MODE",
      DECISION_LEVELS.SAFE_MODE,
      "A critical integrity/replay signal followed repeated serious security events",
    );
  }

  if (restricted && !RESTRICTED_ALLOWED_COMMANDS.includes(commandType)) {
    return decision(
      "RESTRICTED",
      DECISION_LEVELS.RESTRICTED,
      "Operator is restricted to explicitly permitted recovery and safety commands",
    );
  }

  if (
    currentSeriousEventCount + currentSeriousSignals >= SERIOUS_EVENTS_FOR_RESTRICTED &&
    !RESTRICTED_ALLOWED_COMMANDS.includes(commandType)
  ) {
    return decision(
      "RESTRICTED",
      DECISION_LEVELS.RESTRICTED,
      "Repeated serious security events reached the configured restriction threshold",
    );
  }

  if (
    hasSignal("AUTHENTICATION_FAILED") ||
    hasSignal("AUTHORIZATION_FAILED") ||
    hasSignal("INTEGRITY_FAILED") ||
    hasSignal("REPLAY_DETECTED") ||
    hasSignal("TIMESTAMP_INVALID") ||
    hasSignal("COMMAND_VALIDATION_FAILED") ||
    hasSignal("NO_SAFE_PLAN")
  ) {
    return decision(
      "QUARANTINE",
      DECISION_LEVELS.QUARANTINE,
      "A security check failed or no safe modeled execution order exists",
    );
  }

  if (!consequenceSafe && safePlanFound) {
    return decision(
      "HOLD",
      DECISION_LEVELS.HOLD,
      "Current order violates modeled constraints, but a safe reordered plan exists",
    );
  }

  if (!consequenceSafe && planningLimitExceeded) {
    return decision(
      "HOLD",
      DECISION_LEVELS.HOLD,
      "Current order is unsafe and exceeds the planner search limit; manual review is required",
    );
  }

  if (!consequenceSafe) {
    return decision(
      "QUARANTINE",
      DECISION_LEVELS.QUARANTINE,
      "No safe execution is available under modeled constraints",
    );
  }

  if (hasSignal("SUSPICIOUS_COMMAND_BURST")) {
    return decision(
      "WATCH",
      DECISION_LEVELS.WATCH,
      "Command burst exceeded the monitoring threshold; command remains permitted",
    );
  }

  return decision("ALLOW", DECISION_LEVELS.ALLOW, "Security and modeled consequence checks passed");
}

function isSeriousSignal(signal) {
  return [
    "AUTHENTICATION_FAILED",
    "AUTHORIZATION_FAILED",
    "INTEGRITY_FAILED",
    "REPLAY_DETECTED",
  ].includes(signal.type);
}

function decision(action, level, reason) {
  return { decision: action, level, reason };
}

module.exports = {
  DECISION_LEVELS,
  SECURITY_FAILURE_SIGNALS,
  RESTRICTED_ALLOWED_COMMANDS,
  createSecurityFailureSignal,
  createOperationalSignals,
  recordOperatorSubmission,
  restrictOperator,
  isOperatorRestricted,
  clearPolicyState,
  selectDecision,
};