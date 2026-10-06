const { COMMAND_TYPES } = require("./commandTypes");
const { randomUUID } = require("node:crypto");
const { COMMAND_STATUSES } = require("./commandStatus");

const ORIENTATION_VALUES = Object.freeze([
  "NADIR",
  "ZENITH",
  "SUN_POINT",
  "ANTENNA_POINTING",
]);

const COMMAND_DEFINITIONS = Object.freeze({
  [COMMAND_TYPES.PING]: Object.freeze({
    type: COMMAND_TYPES.PING,
    requiredRole: "OPERATOR",
    critical: false,
    requiredParameters: [],
  }),
  [COMMAND_TYPES.CAMERA_ON]: Object.freeze({
    type: COMMAND_TYPES.CAMERA_ON,
    requiredRole: "OPERATOR",
    critical: false,
    requiredParameters: [],
  }),
  [COMMAND_TYPES.CAMERA_OFF]: Object.freeze({
    type: COMMAND_TYPES.CAMERA_OFF,
    requiredRole: "OPERATOR",
    critical: false,
    requiredParameters: [],
  }),
  [COMMAND_TYPES.CAPTURE_IMAGE]: Object.freeze({
    type: COMMAND_TYPES.CAPTURE_IMAGE,
    requiredRole: "OPERATOR",
    critical: false,
    requiredParameters: [],
  }),
  [COMMAND_TYPES.HIGH_POWER_TRANSMISSION]: Object.freeze({
    type: COMMAND_TYPES.HIGH_POWER_TRANSMISSION,
    requiredRole: "MISSION_CONTROLLER",
    critical: true,
    requiresCommunication: true,
    requiredParameters: [],
  }),
  [COMMAND_TYPES.HEATER_ON]: Object.freeze({
    type: COMMAND_TYPES.HEATER_ON,
    requiredRole: "ENGINEER",
    critical: false,
    requiredParameters: [],
  }),
  [COMMAND_TYPES.HEATER_OFF]: Object.freeze({
    type: COMMAND_TYPES.HEATER_OFF,
    requiredRole: "ENGINEER",
    critical: false,
    requiredParameters: [],
  }),
  [COMMAND_TYPES.CHANGE_ORIENTATION]: Object.freeze({
    type: COMMAND_TYPES.CHANGE_ORIENTATION,
    requiredRole: "MISSION_CONTROLLER",
    critical: true,
    requiredParameters: ["orientation"],
    parameterSchema: Object.freeze({
      orientation: Object.freeze({
        type: "string",
        allowedValues: ORIENTATION_VALUES,
      }),
    }),
  }),
  [COMMAND_TYPES.ENTER_SAFE_MODE]: Object.freeze({
    type: COMMAND_TYPES.ENTER_SAFE_MODE,
    requiredRole: "FLIGHT_DIRECTOR",
    critical: true,
    requiredParameters: [],
  }),
  [COMMAND_TYPES.RECOVER]: Object.freeze({
    type: COMMAND_TYPES.RECOVER,
    requiredRole: "FLIGHT_DIRECTOR",
    critical: true,
    requiredParameters: [],
  }),
});

function createCommandInstance({
  id = randomUUID(),
  type,
  parameters = {},
  createdAt,
  status = COMMAND_STATUSES.QUEUED,
  sequence = null,
  requestedBy,
  requestedAt,
}) {
  const command = {
    id,
    type,
    parameters: structuredClone(parameters),
    createdAt: createdAt ?? requestedAt ?? new Date().toISOString(),
    status,
    sequence,
  };

  if (requestedBy !== undefined) command.requestedBy = requestedBy;
  if (requestedAt !== undefined) command.requestedAt = requestedAt;

  return command;
}

module.exports = {
  COMMAND_DEFINITIONS,
  ORIENTATION_VALUES,
  createCommandInstance,
};