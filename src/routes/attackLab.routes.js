const express = require("express");
const { getSession } = require("../domain/mission/commandSessionService");
const { analyzeCommandSequence } = require("../domain/mission/sequenceAnalysisService");
const { tamperPacket, replayPacket, duplicatePacket, reorderSessionPackets, burstPacket } = require("../domain/security/attackInterceptorService");
const { evaluateCommand } = require("../domain/security/decisionEngine");

const router = express.Router();

router.post("/attack-lab/tamper", (request, response) => {
  const { packetId, mutation = {} } = request.body ?? {};
  const packet = request.app.locals?.groundStationPackets?.[packetId];
  if (!packet) {
    return response.status(404).json({ success: false, error: { code: "PACKET_NOT_FOUND", message: "Packet not found" } });
  }

  const result = tamperPacket(packet, mutation);
  return response.json({
    packetId,
    result,
    explanation: "Tamper modifies a signed packet while leaving the original signature unchanged; SATGUARD validates integrity and rejects the mutation",
  });
});

router.post("/attack-lab/replay", (request, response) => {
  const { packetId } = request.body ?? {};
  const packet = request.app.locals?.groundStationPackets?.[packetId];
  if (!packet) {
    return response.status(404).json({ success: false, error: { code: "PACKET_NOT_FOUND", message: "Packet not found" } });
  }

  const result = replayPacket(packet);
  return response.json({
    packetId,
    result,
    explanation: "Replay submits the same signed packet again; the gateway should trigger anti-replay protection",
  });
});

router.post("/attack-lab/duplicate", (request, response) => {
  const { packetId, count = 2 } = request.body ?? {};
  const packet = request.app.locals?.groundStationPackets?.[packetId];
  if (!packet) {
    return response.status(404).json({ success: false, error: { code: "PACKET_NOT_FOUND", message: "Packet not found" } });
  }

  const result = duplicatePacket(packet, count);
  return response.json({ packetId, count, result });
});

router.post("/attack-lab/reorder", (request, response) => {
  const { sessionId, packetOrder = [] } = request.body ?? {};
  const result = reorderSessionPackets(sessionId, packetOrder);
  if (result.error) {
    return response.status(result.error.code === "SESSION_NOT_FOUND" ? 404 : 400).json(result);
  }

  return response.json({
    sessionId,
    result,
    explanation: "Reorder submits the same signed packets in a different order; sequence analysis and planner evaluate the dependency order",
  });
});

router.post("/attack-lab/burst", (request, response) => {
  const { packetId, count = 5 } = request.body ?? {};
  const packet = request.app.locals?.groundStationPackets?.[packetId];
  if (!packet) {
    return response.status(404).json({ success: false, error: { code: "PACKET_NOT_FOUND", message: "Packet not found" } });
  }

  const result = burstPacket(packet, count);
  return response.json({ packetId, count, result });
});

router.post("/attack-lab/session/analyze", (request, response) => {
  const { sessionId } = request.body ?? {};
  const session = getSession(sessionId);
  if (!session) {
    return response.status(404).json({ success: false, error: { code: "SESSION_NOT_FOUND", message: "Session not found" } });
  }

  const analysis = analyzeCommandSequence({ packets: session.packets });
  return response.json({ sessionId, analysis });
});

module.exports = router;
