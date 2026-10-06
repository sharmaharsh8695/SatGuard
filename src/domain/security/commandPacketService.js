const { randomUUID } = require("node:crypto");
const { PROTOTYPE_OPERATORS } = require("../../config/constants");
const { calculateCommandSignature } = require("./commandIntegrity");
const { getOperator } = require("./authenticationService");

function createSignedCommandPacket({
  operatorId,
  commandType,
  parameters = {},
  commandId,
  packetId,
  createdAt,
  timestamp,
  nonce,
} = {}) {
  if (!operatorId || typeof operatorId !== "string") {
    throw new Error("Command packet requires a valid operatorId");
  }

  const operator = getOperator(operatorId) ?? PROTOTYPE_OPERATORS[operatorId];
  if (!operator) {
    throw new Error(`Unknown prototype operator: ${operatorId}`);
  }

  const packetTimestamp = timestamp ?? new Date().toISOString();
  const commandIdentity = commandId ?? `cmd-${randomUUID()}`;
  const packetIdentity = packetId ?? `packet-${randomUUID()}`;
  const packetNonce = nonce ?? `${commandIdentity}-nonce-${randomUUID()}`;

  const command = {
    id: commandIdentity,
    type: commandType,
    parameters: structuredClone(parameters ?? {}),
    timestamp: packetTimestamp,
    nonce: packetNonce,
  };

  const signature = calculateCommandSignature(command, operatorId, operator.hmacSecret);

  return {
    packetId: packetIdentity,
    operatorId,
    command,
    signature,
    createdAt: createdAt ?? new Date().toISOString(),
  };
}

function redactPacket(packet) {
  if (!packet || typeof packet !== "object") {
    return null;
  }

  return {
    packetId: packet.packetId ?? null,
    operatorId: packet.operatorId ?? null,
    createdAt: packet.createdAt ?? null,
    command: {
      id: packet.command?.id ?? null,
      type: packet.command?.type ?? null,
      parameters: structuredClone(packet.command?.parameters ?? {}),
      timestamp: packet.command?.timestamp ?? null,
      nonce: packet.command?.nonce ? `${packet.command.nonce.slice(0, 6)}...` : null,
    },
    signature: packet.signature ? `${packet.signature.slice(0, 8)}...${packet.signature.slice(-4)}` : null,
  };
}

module.exports = {
  createSignedCommandPacket,
  redactPacket,
};
