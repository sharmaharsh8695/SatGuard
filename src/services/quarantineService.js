const { randomUUID } = require("node:crypto");

let quarantinedCommands = [];

function quarantineCommand({
  command,
  operatorId = null,
  reason,
  signals,
  securityResult,
  consequence = null,
  timestamp = new Date().toISOString(),
}) {
  const record = {
    id: randomUUID(),
    commandId: typeof command?.id === "string" ? command.id : null,
    operatorId,
    command: sanitizeCommand(command),
    reason,
    signals: structuredClone(signals),
    timestamp,
    securityResult: sanitizeSecurityResult(securityResult),
    consequence: consequence ? structuredClone(consequence) : null,
  };
  quarantinedCommands.push(record);
  return structuredClone(record);
}

function getAll() {
  return quarantinedCommands.slice().reverse().map((record) => structuredClone(record));
}

function clear() {
  quarantinedCommands = [];
}

function sanitizeCommand(command) {
  if (!command || typeof command !== "object" || Array.isArray(command)) {
    return null;
  }

  const allowedFields = ["id", "type", "parameters", "timestamp", "nonce"];
  return Object.fromEntries(
    allowedFields
      .filter((field) => Object.hasOwn(command, field))
      .map((field) => [field, structuredClone(command[field])]),
  );
}

function sanitizeSecurityResult(result) {
  if (!result) return null;
  return {
    decision: result.decision,
    commandId: result.commandId ?? null,
    operator: structuredClone(result.operator),
    checks: structuredClone(result.checks),
    failedStage: result.failedStage ?? null,
    message: result.message,
  };
}

module.exports = { quarantineCommand, getAll, clear };