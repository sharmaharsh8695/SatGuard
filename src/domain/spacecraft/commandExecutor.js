const { COMMAND_TYPES } = require("../commands/commandTypes");
const { SPACECRAFT_MODES } = require("./spacecraftModes");
const { MISSION_PHASES } = require("../mission/missionState");

const SAFE_MODE_COMMANDS = new Set([
  COMMAND_TYPES.PING,
  COMMAND_TYPES.CAMERA_OFF,
  COMMAND_TYPES.HEATER_OFF,
  COMMAND_TYPES.RECOVER,
]);

function transitionCommand(state, command) {
  if (state.mode === SPACECRAFT_MODES.SAFE && !SAFE_MODE_COMMANDS.has(command.type)) {
    return failure(
      state,
      "INVALID_STATE",
      `${command.type} is not allowed while the spacecraft is in SAFE mode`,
    );
  }

  switch (command.type) {
    case COMMAND_TYPES.PING:
      return success(state, "Spacecraft responded to ping");
    case COMMAND_TYPES.CAMERA_ON:
      return success({ ...state, camera: "ON" }, "Camera turned on");
    case COMMAND_TYPES.CAMERA_OFF:
      return success({ ...state, camera: "OFF" }, "Camera turned off");
    case COMMAND_TYPES.CAPTURE_IMAGE:
      if (state.camera !== "ON") {
        return failure(
          state,
          "INVALID_STATE",
          "CAPTURE_IMAGE requires the camera to be ON",
        );
      }
      if (![MISSION_PHASES.IDLE, MISSION_PHASES.CAPTURE].includes(state.missionPhase)) {
        return failure(
          state,
          "INVALID_STATE",
          "CAPTURE_IMAGE can only run from IDLE or CAPTURE mission phase",
        );
      }
      return success(
        {
          ...state,
          missionPhase: MISSION_PHASES.IDLE,
          imagesCaptured: state.imagesCaptured + 1,
        },
        "Image captured",
      );
    case COMMAND_TYPES.HIGH_POWER_TRANSMISSION:
      if (state.radio === "OFF" || state.antenna !== "DEPLOYED") {
        return failure(
          state,
          "INVALID_STATE",
          "HIGH_POWER_TRANSMISSION requires an available radio and deployed antenna",
        );
      }
      if (![MISSION_PHASES.IDLE, MISSION_PHASES.CAPTURE].includes(state.missionPhase)) {
        return failure(
          state,
          "INVALID_STATE",
          "HIGH_POWER_TRANSMISSION can only begin from IDLE or CAPTURE mission phase",
        );
      }
      return success(
        {
          ...state,
          battery: Math.max(0, state.battery - 5),
          missionPhase: MISSION_PHASES.TRANSMIT,
        },
        "High-power transmission completed; simulated battery reduced by 5 percentage points",
      );
    case COMMAND_TYPES.HEATER_ON:
      return success({ ...state, heater: "ON" }, "Heater turned on");
    case COMMAND_TYPES.HEATER_OFF:
      return success({ ...state, heater: "OFF" }, "Heater turned off");
    case COMMAND_TYPES.CHANGE_ORIENTATION:
      return success(
        { ...state, orientation: command.parameters.orientation },
        `Orientation changed to ${command.parameters.orientation}`,
      );
    case COMMAND_TYPES.ENTER_SAFE_MODE:
      return success({ ...state, mode: SPACECRAFT_MODES.SAFE }, "Spacecraft entered SAFE mode");
    case COMMAND_TYPES.RECOVER:
      if (state.mode !== SPACECRAFT_MODES.SAFE) {
        return failure(state, "INVALID_STATE", "RECOVER is only available from SAFE mode");
      }
      if (state.camera !== "OFF") {
        return failure(
          state,
          "INVALID_STATE",
          "Recovery requires the camera to be OFF",
        );
      }
      return success(
        { ...state, mode: SPACECRAFT_MODES.NOMINAL },
        "Spacecraft recovered to NOMINAL mode",
      );
    default:
      return failure(state, "UNKNOWN_COMMAND", `Unknown command type: ${command.type}`);
  }
}

function success(state, message) {
  return { success: true, state: { ...state }, result: { message } };
}

function failure(state, code, message) {
  return { success: false, state: { ...state }, error: { code, message } };
}

module.exports = {
  transitionCommand,
  executeCommand: transitionCommand,
};