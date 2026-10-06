const { COMMAND_TYPES } = require("../commands/commandTypes");

const OPERATOR_COMMANDS = Object.freeze([
  COMMAND_TYPES.PING,
  COMMAND_TYPES.CAMERA_ON,
  COMMAND_TYPES.CAMERA_OFF,
  COMMAND_TYPES.CAPTURE_IMAGE,
]);

const ENGINEER_COMMANDS = Object.freeze([
  COMMAND_TYPES.HIGH_POWER_TRANSMISSION,
  COMMAND_TYPES.HEATER_ON,
  COMMAND_TYPES.HEATER_OFF,
  COMMAND_TYPES.CHANGE_ORIENTATION,
]);

const COMMAND_PERMISSIONS = Object.freeze({
  OPERATOR: OPERATOR_COMMANDS,
  MISSION_ENGINEER: Object.freeze([...OPERATOR_COMMANDS, ...ENGINEER_COMMANDS]),
  ADMIN: Object.freeze(Object.values(COMMAND_TYPES)),
});

function authorizeCommand(role, commandType) {
  const permissions = Object.hasOwn(COMMAND_PERMISSIONS, role)
    ? COMMAND_PERMISSIONS[role]
    : null;
  const authorized = permissions?.includes(commandType) ?? false;
  return {
    authorized,
    role: role ?? null,
    commandType: commandType ?? null,
    reason: authorized
      ? "Role is permitted to submit this command"
      : "Role is not permitted to submit this command",
  };
}

module.exports = { authorizeCommand };