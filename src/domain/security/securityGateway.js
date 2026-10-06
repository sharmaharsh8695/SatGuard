const { validateCommand } = require("../commands/commandValidation");
const { authenticateOperator, getOperator } = require("./authenticationService");
const { authorizeCommand } = require("./authorizationService");
const { verifyCommandIntegrity } = require("./commandIntegrity");
const {
  checkTimestampAndReplay,
  consumeCommandIdentity,
} = require("./replayProtection");

const TOP_LEVEL_FIELDS = new Set([
  "operatorId",
  "credential",
  "command",
  "signature",
]);
const COMMAND_FIELDS = new Set(["id", "type", "parameters", "timestamp", "nonce"]);

function evaluateCommandEnvelope(envelope, { now = Date.now() } = {}) {
  const checks = createChecks();
  const context = {
    operatorId: typeof envelope?.operatorId === "string" ? envelope.operatorId : null,
    commandId: typeof envelope?.command?.id === "string" ? envelope.command.id : null,
    commandType: typeof envelope?.command?.type === "string" ? envelope.command.type : null,
  };
  const structure = validateEnvelope(envelope);

  if (!structure.valid) {
    checks.commandValidation = {
      passed: false,
      reason: structure.error.message,
    };
    return rejected(context, checks, "commandValidation", structure.error.message);
  }

  const { operatorId, credential, signature, command } = structure.value;
  context.operatorId = operatorId;
  context.commandId = command.id;
  context.commandType = command.type;
  checks.commandValidation = { passed: true, reason: "Command structure and parameters are valid" };

  const authentication = authenticateOperator(operatorId, credential);
  checks.authentication = {
    passed: authentication.authenticated,
    ...authentication,
  };
  if (!authentication.authenticated) {
    return rejected(context, checks, "authentication", authentication.reason);
  }

  const authorization = authorizeCommand(authentication.role, command.type);
  checks.authorization = {
    passed: authorization.authorized,
    ...authorization,
  };
  if (!authorization.authorized) {
    return rejected(context, checks, "authorization", authorization.reason);
  }

  const replayStatus = checkTimestampAndReplay({
    operatorId,
    commandId: command.id,
    nonce: command.nonce,
    timestamp: command.timestamp,
    now,
  });
  checks.replay = {
    passed: replayStatus.timestampValid && !replayStatus.replayDetected,
    ...replayStatus,
  };
  if (!checks.replay.passed) {
    return rejected(context, checks, "replay", replayStatus.reason);
  }

  const operator = getOperator(operatorId);
  const integrity = verifyCommandIntegrity(
    command,
    operatorId,
    operator.hmacSecret,
    signature,
  );
  checks.integrity = {
    passed: integrity.integrityValid,
    ...integrity,
  };
  if (!integrity.integrityValid) {
    return rejected(context, checks, "integrity", integrity.reason);
  }

  const consumption = consumeCommandIdentity({
    operatorId,
    commandId: command.id,
    nonce: command.nonce,
    timestamp: command.timestamp,
    now,
  });
  if (consumption.replayDetected || !consumption.timestampValid) {
    checks.replay = { passed: false, ...consumption };
    return rejected(context, checks, "replay", consumption.reason);
  }

  return {
    decision: "ACCEPTED",
    commandId: command.id,
    operator: { id: authentication.operatorId, role: authentication.role },
    checks,
    failedStage: null,
    message: "Command accepted by security gateway",
    acceptedCommand: {
      id: command.id,
      type: command.type,
      parameters: structuredClone(command.parameters),
    },
  };
}

function validateEnvelope(envelope) {
  if (!isRecord(envelope)) {
    return invalid("INVALID_ENVELOPE", "Request must be a JSON object");
  }

  if (hasUnknownFields(envelope, TOP_LEVEL_FIELDS)) {
    return invalid("INVALID_ENVELOPE", "Request contains unsupported fields");
  }

  if (
    typeof envelope.operatorId !== "string" ||
    typeof envelope.credential !== "string" ||
    typeof envelope.signature !== "string" ||
    !isRecord(envelope.command)
  ) {
    return invalid(
      "INVALID_ENVELOPE",
      "Request requires operatorId, credential, command object, and signature",
    );
  }

  if (hasUnknownFields(envelope.command, COMMAND_FIELDS)) {
    return invalid("INVALID_ENVELOPE", "Command contains unsupported fields");
  }

  if (
    typeof envelope.command.id !== "string" ||
    envelope.command.id.length === 0 ||
    typeof envelope.command.timestamp !== "string" ||
    typeof envelope.command.nonce !== "string" ||
    envelope.command.nonce.length === 0
  ) {
    return invalid(
      "INVALID_ENVELOPE",
      "Command requires a non-empty id, timestamp, and nonce",
    );
  }

  const validation = validateCommand(envelope.command);
  if (!validation.valid) {
    return { valid: false, error: validation.error };
  }

  return {
    valid: true,
    value: {
      operatorId: envelope.operatorId,
      credential: envelope.credential,
      signature: envelope.signature,
      command: {
        ...validation.command,
        id: envelope.command.id,
        timestamp: envelope.command.timestamp,
        nonce: envelope.command.nonce,
      },
    },
  };
}

function createChecks() {
  return {
    commandValidation: { passed: null, reason: "Not checked" },
    authentication: {
      passed: null,
      authenticated: null,
      operatorId: null,
      role: null,
      reason: "Not checked",
    },
    authorization: {
      passed: null,
      authorized: null,
      role: null,
      commandType: null,
      reason: "Not checked",
    },
    integrity: {
      passed: null,
      integrityValid: null,
      reason: "Not checked",
    },
    replay: {
      passed: null,
      replayDetected: null,
      timestampValid: null,
      reason: "Not checked",
    },
  };
}

function rejected(context, checks, failedStage, message) {
  const operator = getOperator(context.operatorId);
  return {
    decision: "REJECTED",
    commandId: context.commandId,
    operator: {
      id: context.operatorId,
      role: checks.authentication.passed ? operator.role : null,
    },
    checks,
    failedStage,
    message,
  };
}

function hasUnknownFields(value, allowedFields) {
  return Object.keys(value).some((field) => !allowedFields.has(field));
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalid(code, message) {
  return { valid: false, error: { code, message } };
}

module.exports = { evaluateCommandEnvelope };