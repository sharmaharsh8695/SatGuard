const { COMMAND_TYPES } = require("../commands/commandTypes");
const { SPACECRAFT_MODES } = require("../spacecraft/spacecraftModes");
const { SERIOUS_EVENT_WINDOW_MS } = require("../../config/constants");
const { evaluateCommandEnvelope } = require("./securityGateway");
const {
  createSecurityFailureSignal,
  createOperationalSignals,
  recordOperatorSubmission,
  restrictOperator,
  isOperatorRestricted,
  selectDecision,
} = require("./securityPolicy");
const { getOperator } = require("./authenticationService");
const { simulate } = require("../../services/consequenceSimulator");
const { planExecution } = require("../planning/executionPlanner");
const commandQueueService = require("../../services/commandQueueService");
const spacecraftService = require("../../services/spacecraftService");
const incidentService = require("../../services/incidentService");
const quarantineService = require("../../services/quarantineService");

function evaluateCommand(envelope, { now = Date.now() } = {}) {
  const security = evaluateCommandEnvelope(envelope, { now });
  const knownOperatorId = getOperator(envelope?.operatorId)
    ? envelope.operatorId
    : null;
  const burstSignal = recordOperatorSubmission(knownOperatorId, now);
  const priorSeriousEventCount = knownOperatorId
    ? incidentService.countRecentSeriousEvents(
        knownOperatorId,
        now,
        SERIOUS_EVENT_WINDOW_MS,
      )
    : 0;
  const command = sanitizeCommand(envelope?.command);

  if (security.decision !== "ACCEPTED") {
    const signals = [createSecurityFailureSignal(security), ...optionalSignal(burstSignal)];
    const selected = selectDecision({
      signals,
      currentSeriousEventCount: priorSeriousEventCount,
      restricted: knownOperatorId ? isOperatorRestricted(knownOperatorId) : false,
      commandType: command?.type,
    });
    return finalizeDecision({
      security,
      command,
      operatorId: knownOperatorId,
      signals,
      selected,
      now,
    });
  }

  const commandType = security.acceptedCommand.type;
  const restricted = isOperatorRestricted(security.operator.id);
  const signals = [];
  if (restricted) {
    signals.push({
      type: "OPERATOR_RESTRICTED",
      severity: "HIGH",
      message: "Operator is under a prototype command restriction",
    });
  }
  if (burstSignal) signals.push(burstSignal);

  const currentState = spacecraftService.getState();
  const commands = [
    ...commandQueueService.getSnapshot(),
    structuredClone(security.acceptedCommand),
  ];
  const consequence = simulate({ currentState, commands });
  const planner = consequence.safe
    ? null
    : planExecution({ currentState, commands });
  signals.push(...createOperationalSignals(consequence, planner));

  const selected = selectDecision({
    signals,
    currentSeriousEventCount: priorSeriousEventCount,
    restricted,
    commandType,
    consequenceSafe: consequence.safe,
    safePlanFound: planner?.status === "SAFE_REORDER_FOUND",
    planningLimitExceeded: planner?.status === "PLANNING_LIMIT_EXCEEDED",
  });

  return finalizeDecision({
    security,
    command,
    operatorId: security.operator.id,
    signals,
    selected,
    consequence,
    planner,
    now,
  });
}

function finalizeDecision({
  security,
  command,
  operatorId,
  signals,
  selected,
  consequence = null,
  planner = null,
  now,
}) {
  let action = null;
  let decision = selected.decision;
  let level = selected.level;
  let reason = selected.reason;
  const acceptedCommand = security.acceptedCommand;

  if (decision === "ALLOW" || decision === "WATCH") {
    const queued = commandQueueService.enqueue(acceptedCommand, { preserveId: true });
    if (queued.success) {
      action = { type: "ENQUEUED", status: queued.command.status, sequence: queued.command.sequence };
    } else {
      signals.push({
        type: "QUEUE_ADMISSION_FAILED",
        severity: "HIGH",
        message: queued.error.message,
      });
      decision = "QUARANTINE";
      level = "L3";
      reason = "Security passed, but the command could not be admitted to the queue";
    }
  }

  if (decision === "HOLD") {
    const holdDetails = {
      heldAt: new Date(now).toISOString(),
      operatorId,
      originalCommand: command,
      securityValidation: publicSecurityResult(security),
      consequence,
      planner,
      reason,
    };
    const held = commandQueueService.enqueue(acceptedCommand, {
      preserveId: true,
      status: "HELD",
      holdDetails,
    });
    if (held.success) {
      action = { type: "HELD", status: held.command.status, sequence: held.command.sequence };
    } else {
      signals.push({
        type: "QUEUE_ADMISSION_FAILED",
        severity: "HIGH",
        message: held.error.message,
      });
      decision = "QUARANTINE";
      level = "L3";
      reason = "Command met hold policy but could not be retained in the queue";
    }
  }

  if (decision === "RESTRICTED") {
    restrictOperator(operatorId);
  }

  let safeModeAction = null;
  if (decision === "SAFE_MODE") {
    restrictOperator(operatorId);
    const currentState = spacecraftService.getState();
    if (currentState.mode === SPACECRAFT_MODES.SAFE) {
      safeModeAction = {
        triggered: false,
        success: true,
        message: "Prototype SAFE mode is already active",
      };
    } else {
      const result = spacecraftService.executeCommand({
        type: COMMAND_TYPES.ENTER_SAFE_MODE,
      });
      safeModeAction = {
        triggered: true,
        success: result.success,
        message: result.result?.message ?? result.error?.message,
        prototypePolicyAction: true,
      };
    }
  }

  if (["QUARANTINE", "RESTRICTED", "SAFE_MODE"].includes(decision)) {
    action = {
      type: "QUARANTINED",
      record: quarantineService.quarantineCommand({
        command,
        operatorId,
        reason,
        signals,
        securityResult: security,
        consequence,
        timestamp: new Date(now).toISOString(),
      }),
    };
  }

  const response = {
    decision,
    level,
    command,
    operator: security.operator,
    security: publicSecurityResult(security),
    signals: structuredClone(signals),
    consequence,
    planner,
    reason,
    timestamp: new Date(now).toISOString(),
    action: action ? summarizeAction(action) : null,
    ...(safeModeAction ? { safeModeAction } : {}),
  };

  response.event = incidentService.recordEvent({
    timestamp: response.timestamp,
    type: eventType(decision, signals),
    severity: highestSeverity(signals, decision),
    commandId: command?.id ?? null,
    commandType: command?.type ?? null,
    operatorId,
    decision,
    level,
    message: reason,
    signals,
  });

  return response;
}

function publicSecurityResult(security) {
  return {
    decision: security.decision,
    commandId: security.commandId ?? null,
    operator: structuredClone(security.operator),
    checks: structuredClone(security.checks),
    failedStage: security.failedStage ?? null,
    message: security.message,
  };
}

function sanitizeCommand(command) {
  if (!command || typeof command !== "object" || Array.isArray(command)) return null;
  const fields = ["id", "type", "parameters", "timestamp", "nonce"];
  return Object.fromEntries(
    fields
      .filter((field) => Object.hasOwn(command, field))
      .map((field) => [field, structuredClone(command[field])]),
  );
}

function optionalSignal(signal) {
  return signal ? [signal] : [];
}

function summarizeAction(action) {
  if (action.type === "QUARANTINED") {
    return { type: action.type, recordId: action.record.id };
  }
  return action;
}

function eventType(decision, signals) {
  if (decision === "ALLOW" || decision === "WATCH") {
    return decision === "WATCH" ? "COMMAND_WATCHED" : "COMMAND_ALLOWED";
  }
  if (decision === "HOLD") return "COMMAND_HELD";
  if (decision === "SAFE_MODE") return "SAFE_MODE_SELECTED";
  return signals[0]?.type ?? `COMMAND_${decision}`;
}

function highestSeverity(signals, decision) {
  const rank = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
  const highest = signals.reduce(
    (severity, signal) => rank[signal.severity] > rank[severity] ? signal.severity : severity,
    "LOW",
  );
  if (decision === "SAFE_MODE") return "CRITICAL";
  if (decision === "RESTRICTED" || decision === "QUARANTINE") {
    return rank[highest] >= rank.HIGH ? highest : "HIGH";
  }
  return highest;
}

module.exports = { evaluateCommand };