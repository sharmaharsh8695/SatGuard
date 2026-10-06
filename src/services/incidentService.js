const { randomUUID } = require("node:crypto");

const SERIOUS_SIGNAL_TYPES = new Set([
  "AUTHENTICATION_FAILED",
  "AUTHORIZATION_FAILED",
  "INTEGRITY_FAILED",
  "REPLAY_DETECTED",
]);

let events = [];

function recordEvent({
  timestamp = new Date().toISOString(),
  type,
  severity,
  commandId = null,
  commandType = null,
  operatorId = null,
  decision,
  level,
  message,
  signals = [],
}) {
  const event = {
    id: randomUUID(),
    timestamp,
    type,
    severity,
    commandId,
    commandType,
    operatorId,
    decision,
    level,
    message,
    signals: structuredClone(signals),
  };
  events.push(event);
  return structuredClone(event);
}

function getEvents() {
  return events.slice().reverse().map((event) => structuredClone(event));
}

function countRecentSeriousEvents(operatorId, now, windowMs) {
  return events.filter((event) => {
    if (event.operatorId !== operatorId || now - Date.parse(event.timestamp) > windowMs) {
      return false;
    }
    return event.signals.some((signal) => SERIOUS_SIGNAL_TYPES.has(signal.type));
  }).length;
}

function clear() {
  events = [];
}

module.exports = { recordEvent, getEvents, countRecentSeriousEvents, clear };