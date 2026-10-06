const { evaluateSignedPacket } = require("./signedPacketEvaluator");
const { createSignedCommandPacket, redactPacket } = require("./commandPacketService");
const { getSession } = require("../mission/commandSessionService");

function tamperPacket(packet, mutation = {}) {
  const original = structuredClone(packet);
  const tampered = structuredClone(packet);
  tampered.command = {
    ...tampered.command,
    ...(mutation.command ?? {}),
    parameters: {
      ...(tampered.command?.parameters ?? {}),
      ...(mutation.parameters ?? {}),
    },
    type: mutation.type ?? tampered.command.type,
    nonce: mutation.nonce ?? tampered.command.nonce,
    timestamp: mutation.timestamp ?? tampered.command.timestamp,
  };

  const result = evaluateSignedPacket(tampered);

  return {
    originalPacket: redactPacket(original),
    tamperedPacket: redactPacket(tampered),
    result,
  };
}

function replayPacket(packet) {
  const original = structuredClone(packet);
  const result = evaluateSignedPacket(packet);

  return {
    originalPacket: redactPacket(original),
    replayPacket: redactPacket(structuredClone(packet)),
    result,
  };
}

function duplicatePacket(packet, count = 2) {
  const packets = Array.from({ length: Math.max(1, Number(count) || 1) }, () => structuredClone(packet));
  const evaluations = packets.map((entry) => evaluateSignedPacket(entry));

  return {
    originalPacket: redactPacket(packet),
    duplicatePackets: packets.map((entry) => redactPacket(entry)),
    evaluations,
  };
}

function reorderSessionPackets(sessionId, orderedPacketIds) {
  const session = getSession(sessionId);
  if (!session) {
    return { error: { code: "SESSION_NOT_FOUND", message: "Session not found" } };
  }

  const map = new Map(session.packets.map((packet) => [packet.packetId, packet]));
  const ordered = orderedPacketIds
    .map((packetId) => map.get(packetId))
    .filter(Boolean);

  if (ordered.length !== session.packets.length) {
    return {
      error: {
        code: "INVALID_REORDER",
        message: "Reorder request does not reference all session packets",
      },
    };
  }

  const results = ordered.map((packet) => evaluateSignedPacket(packet));
  return {
    sessionId,
    packetOrder: ordered.map((packet) => packet.packetId),
    results,
  };
}

function burstPacket(packet, count = 5) {
  const burstPackets = Array.from({ length: Math.max(1, Number(count) || 1) }, () => structuredClone(packet));
  const results = burstPackets.map((entry) => evaluateSignedPacket(entry));
  return {
    packet: redactPacket(packet),
    burstCount: burstPackets.length,
    results,
  };
}

function createGroundPacket({ operatorId, commandType, parameters = {} }) {
  return createSignedCommandPacket({ operatorId, commandType, parameters });
}

module.exports = {
  tamperPacket,
  replayPacket,
  duplicatePacket,
  reorderSessionPackets,
  burstPacket,
  createGroundPacket,
};
