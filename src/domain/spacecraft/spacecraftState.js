const { SPACECRAFT_MODES } = require("./spacecraftModes");
const { MISSION_PHASES } = require("../mission/missionState");

function createInitialSpacecraftState() {
  // Hackathon-only values: battery and fuel are percentages; temperature is Celsius.
  return {
    mode: SPACECRAFT_MODES.NOMINAL,
    battery: 85,
    fuel: 72,
    temperature: 21,
    orientation: "NADIR",
    camera: "OFF",
    heater: "OFF",
    radio: "IDLE",
    antenna: "DEPLOYED",
    missionPhase: MISSION_PHASES.IDLE,
    imagesCaptured: 0,
  };
}

module.exports = { createInitialSpacecraftState };