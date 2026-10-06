const { COMMAND_TIMESTAMP_WINDOW_MS } = require("../../config/constants");

const usedCommandIds = new Map();
const usedOperatorNonces = new Map();

function checkTimestampAndReplay({ operatorId, commandId, nonce, timestamp, now = Date.now() }) {
  const timestampMs = parseCanonicalTimestamp(timestamp);
  if (timestampMs === null) {
    return {
      replayDetected: false,
      timestampValid: false,
      reason: "Timestamp must be a valid ISO-8601 UTC timestamp",
    };
  }

  if (Math.abs(now - timestampMs) > COMMAND_TIMESTAMP_WINDOW_MS) {
    return {
      replayDetected: false,
      timestampValid: false,
      reason: "Command timestamp is outside the allowed time window",
    };
  }

  pruneExpiredEntries(now);
  if (usedCommandIds.has(commandId)) {
    return {
      replayDetected: true,
      timestampValid: true,
      reason: "Command ID has already been used",
    };
  }

  if (usedOperatorNonces.has(nonceKey(operatorId, nonce))) {
    return {
      replayDetected: true,
      timestampValid: true,
      reason: "Nonce has already been used by this operator",
    };
  }

  return {
    replayDetected: false,
    timestampValid: true,
    reason: "Timestamp is valid and command ID/nonce are unused",
  };
}

function consumeCommandIdentity({ operatorId, commandId, nonce, timestamp, now = Date.now() }) {
  const status = checkTimestampAndReplay({ operatorId, commandId, nonce, timestamp, now });
  if (status.replayDetected || !status.timestampValid) {
    return status;
  }

  const timestampMs = Date.parse(timestamp);
  usedCommandIds.set(commandId, timestampMs);
  usedOperatorNonces.set(nonceKey(operatorId, nonce), timestampMs);
  return status;
}

function parseCanonicalTimestamp(timestamp) {
  if (typeof timestamp !== "string") {
    return null;
  }

  const timestampMs = Date.parse(timestamp);
  if (!Number.isFinite(timestampMs) || new Date(timestampMs).toISOString() !== timestamp) {
    return null;
  }

  return timestampMs;
}

function nonceKey(operatorId, nonce) {
  return `${operatorId}:${nonce}`;
}

function pruneExpiredEntries(now) {
  const cutoff = now - COMMAND_TIMESTAMP_WINDOW_MS;
  for (const [key, timestamp] of usedCommandIds) {
    if (timestamp < cutoff) usedCommandIds.delete(key);
  }
  for (const [key, timestamp] of usedOperatorNonces) {
    if (timestamp < cutoff) usedOperatorNonces.delete(key);
  }
}

function clearReplayState() {
  usedCommandIds.clear();
  usedOperatorNonces.clear();
}

module.exports = {
  checkTimestampAndReplay,
  consumeCommandIdentity,
  clearReplayState,
};