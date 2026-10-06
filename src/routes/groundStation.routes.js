const express = require("express");
const { createSignedCommandPacket, redactPacket } = require("../domain/security/commandPacketService");
const { createSession, getSession, listSessions } = require("../domain/mission/commandSessionService");
const { analyzeCommandSequence } = require("../domain/mission/sequenceAnalysisService");
const { evaluateSignedPacket } = require("../domain/security/signedPacketEvaluator");
const spacecraftService = require("../services/spacecraftService");

const router = express.Router();

router.get("/ground-station/sessions", (request, response) => {
  return response.json({ sessions: listSessions() });
});

router.post("/ground-station/commands", (request, response) => {
  const { operatorId, type, parameters = {} } = request.body ?? {};

  try {
    const packet = createSignedCommandPacket({ operatorId, commandType: type, parameters });
    return response.status(201).json({
      packet: redactPacket(packet),
      transmission: {
        status: "SIGNED_AND_READY",
        operatorId,
        commandType: type,
      },
    });
  } catch (error) {
    return response.status(400).json({
      success: false,
      error: { code: "INVALID_GROUND_STATION_COMMAND", message: error.message },
    });
  }
});

router.get("/ground-station/packets/:packetId", (request, response) => {
  const packet = request.app.locals?.groundStationPackets?.[request.params.packetId];
  if (!packet) {
    return response.status(404).json({
      success: false,
      error: { code: "PACKET_NOT_FOUND", message: "Packet not found" },
    });
  }

  return response.json({ packet: redactPacket(packet) });
});

router.post("/ground-station/sessions", (request, response) => {
  const { operatorId, commands = [] } = request.body ?? {};
  if (!operatorId || !Array.isArray(commands) || commands.length === 0) {
    return response.status(400).json({
      success: false,
      error: { code: "INVALID_SESSION", message: "Session requires an operatorId and an array of commands" },
    });
  }

  try {
    const packets = commands.map((entry) => createSignedCommandPacket({
      operatorId,
      commandType: entry.type,
      parameters: entry.parameters ?? {},
    }));

    const session = createSession({ operatorId, packets });
    request.app.locals = request.app.locals ?? {};
    request.app.locals.groundStationPackets = request.app.locals.groundStationPackets ?? {};
    for (const packet of packets) {
      request.app.locals.groundStationPackets[packet.packetId] = packet;
    }

    return response.status(201).json({ session: { ...session, packets: packets.map(redactPacket) } });
  } catch (error) {
    return response.status(400).json({
      success: false,
      error: { code: "INVALID_SESSION", message: error.message },
    });
  }
});

router.get("/ground-station/sessions/:sessionId", (request, response) => {
  const session = getSession(request.params.sessionId);
  if (!session) {
    return response.status(404).json({
      success: false,
      error: { code: "SESSION_NOT_FOUND", message: "Session not found" },
    });
  }

  return response.json({
    session: {
      ...session,
      packets: session.packets.map((packet) => ({
        packetId: packet.packetId,
        operatorId: packet.operatorId,
        command: packet.command,
        signature: `${packet.signature?.slice(0, 8) ?? ""}...${packet.signature?.slice(-4) ?? ""}`,
        createdAt: packet.createdAt,
      })),
    },
  });
});

router.post("/ground-station/sessions/:sessionId/submit", (request, response) => {
  const session = getSession(request.params.sessionId);
  if (!session) {
    return response.status(404).json({
      success: false,
      error: { code: "SESSION_NOT_FOUND", message: "Session not found" },
    });
  }

  const currentState = spacecraftService.getState();
  const sequenceAnalysis = analyzeCommandSequence({
    packets: session.packets,
    currentState,
  });

  const decisions = session.packets.map((packet) => evaluateSignedPacket(packet));

  return response.json({
    sessionId: session.sessionId,
    sequenceAnalysis,
    decisions,
    summary: {
      totalPackets: session.packets.length,
      accepted: decisions.filter((entry) => entry.decision === "ALLOW" || entry.decision === "WATCH" || entry.decision === "HOLD").length,
      rejected: decisions.filter((entry) => entry.decision === "REJECTED" || entry.decision === "QUARANTINE" || entry.decision === "SAFE_MODE").length,
    },
  });
});

module.exports = router;
