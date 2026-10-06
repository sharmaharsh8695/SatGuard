const MISSION_PHASES = Object.freeze({
  IDLE: "IDLE",
  CAPTURE: "CAPTURE",
  TRANSMIT: "TRANSMIT",
  ECLIPSE: "ECLIPSE",
});

function createInitialMissionState() {
  return { phase: MISSION_PHASES.IDLE };
}

module.exports = { MISSION_PHASES, createInitialMissionState };