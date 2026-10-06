const { COMMAND_DEFINITIONS } = require("./commandSchema");

function validateCommand(command) {
  if (!command || typeof command !== "object" || Array.isArray(command)) {
    return invalid("INVALID_COMMAND", "Command must be a JSON object");
  }

  if (typeof command.type !== "string") {
    return invalid("INVALID_COMMAND", "Command type must be a string");
  }

  const definition = Object.hasOwn(COMMAND_DEFINITIONS, command.type)
    ? COMMAND_DEFINITIONS[command.type]
    : null;
  if (!definition) {
    return invalid("UNKNOWN_COMMAND", `Unknown command type: ${command.type}`);
  }

  const parameters = command.parameters === undefined ? {} : command.parameters;
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) {
    return invalid("INVALID_COMMAND", "Command parameters must be a JSON object");
  }

  for (const parameterName of definition.requiredParameters) {
    if (!Object.hasOwn(parameters, parameterName)) {
      return invalid(
        "MISSING_PARAMETER",
        `Command ${command.type} requires parameter: ${parameterName}`,
      );
    }
  }

  for (const [parameterName, value] of Object.entries(parameters)) {
    const parameterDefinition = definition.parameterSchema?.[parameterName];
    if (!parameterDefinition) {
      return invalid(
        "UNKNOWN_PARAMETER",
        `Command ${command.type} does not accept parameter: ${parameterName}`,
      );
    }

    if (typeof value !== parameterDefinition.type) {
      return invalid(
        "INVALID_PARAMETER",
        `Parameter ${parameterName} must be a ${parameterDefinition.type}`,
      );
    }

    if (
      parameterDefinition.allowedValues &&
      !parameterDefinition.allowedValues.includes(value)
    ) {
      return invalid(
        "INVALID_PARAMETER_VALUE",
        `Parameter ${parameterName} must be one of: ${parameterDefinition.allowedValues.join(", ")}`,
      );
    }
  }

  return { valid: true, command: { ...command, parameters: { ...parameters } } };
}

function invalid(code, message) {
  return { valid: false, error: { code, message } };
}

module.exports = { validateCommand };