const { randomUUID } = require("node:crypto");

const sessions = new Map();

function createSession({ operatorId, packets = [], metadata = {} } = {}) {
  if (!operatorId || typeof operatorId !== "string") {
    throw new Error("Session requires a valid operatorId");
  }

  if (!Array.isArray(packets)) {
    throw new Error("Session packets must be an array");
  }

  const now = new Date().toISOString();
  const sessionId = `SESSION-${randomUUID().slice(0, 8)}`;
  const session = {
    sessionId,
    operatorId,
    createdAt: now,
    updatedAt: now,
    status: "OPEN",
    packets: packets.map((packet) => normalizePacket(packet)),
    metadata: { ...metadata },
  };

  sessions.set(sessionId, structuredClone(session));
  return structuredClone(session);
}

function addPacket(sessionId, packet) {
  const session = sessions.get(sessionId);
  if (!session) {
    return null;
  }

  const normalizedPacket = normalizePacket(packet);
  session.packets.push(normalizedPacket);
  session.updatedAt = new Date().toISOString();
  return structuredClone(session);
}

function getSession(sessionId) {
  const session = sessions.get(sessionId);
  return session ? structuredClone(session) : null;
}

function listSessions() {
  return Array.from(sessions.values()).map((session) => structuredClone(session));
}

function clearSessions() {
  sessions.clear();
}

function normalizePacket(packet) {
  if (!packet || typeof packet !== "object") {
    return {
      packetId: `packet-${randomUUID().slice(0, 8)}`,
      operatorId: null,
      createdAt: new Date().toISOString(),
      command: { id: null, type: null, parameters: {}, timestamp: null, nonce: null },
      signature: null,
    };
  }

  return {
    packetId: packet.packetId ?? `packet-${randomUUID().slice(0, 8)}`,
    operatorId: packet.operatorId ?? null,
    command: {
      id: packet.command?.id ?? null,
      type: packet.command?.type ?? null,
      parameters: structuredClone(packet.command?.parameters ?? {}),
      timestamp: packet.command?.timestamp ?? null,
      nonce: packet.command?.nonce ?? null,
    },
    signature: packet.signature ?? null,
    createdAt: packet.createdAt ?? new Date().toISOString(),
  };
}

module.exports = {
  createSession,
  addPacket,
  getSession,
  listSessions,
  clearSessions,
};
