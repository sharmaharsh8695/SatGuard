const { createHmac, timingSafeEqual } = require("node:crypto");

function createCanonicalPayload(command, operatorId) {
  return {
    commandId: command.id,
    commandType: command.type,
    commandParameters: command.parameters ?? {},
    timestamp: command.timestamp,
    nonce: command.nonce,
    operatorId,
  };
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function calculateCommandSignature(command, operatorId, secret) {
  const payload = createCanonicalPayload(command, operatorId);
  return createHmac("sha256", secret)
    .update(canonicalize(payload), "utf8")
    .digest("hex");
}

function verifyCommandIntegrity(command, operatorId, secret, signature) {
  const expected = Buffer.from(
    calculateCommandSignature(command, operatorId, secret),
    "hex",
  );
  const validFormat = typeof signature === "string" && /^[a-f0-9]{64}$/i.test(signature);
  const provided = validFormat ? Buffer.from(signature, "hex") : Buffer.alloc(0);
  const comparable = provided.length === expected.length
    ? provided
    : Buffer.alloc(expected.length);
  const matches = timingSafeEqual(expected, comparable) && validFormat;

  return {
    integrityValid: matches,
    reason: matches
      ? "Command HMAC is valid"
      : "Command integrity verification failed",
  };
}

module.exports = {
  createCanonicalPayload,
  canonicalize,
  calculateCommandSignature,
  verifyCommandIntegrity,
};