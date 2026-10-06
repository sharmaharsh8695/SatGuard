const {
  MIN_BATTERY,
  MIN_FUEL,
  MIN_TEMPERATURE,
  MAX_TEMPERATURE,
} = require("../../config/constants");
const { COMMAND_DEFINITIONS } = require("../commands/commandSchema");

function evaluateSafetyConstraints(state, command, commandOrder) {
  const violations = [];

  if (state.battery < MIN_BATTERY) {
    violations.push({
      code: "BATTERY_BELOW_MINIMUM",
      message: `Battery ${state.battery}% is below the modeled minimum of ${MIN_BATTERY}%`,
      value: state.battery,
      limit: MIN_BATTERY,
      commandOrder: commandOrder ?? null,
    });
  }

  if (state.fuel < MIN_FUEL) {
    violations.push({
      code: "FUEL_BELOW_MINIMUM",
      message: `Fuel ${state.fuel}% is below the modeled minimum of ${MIN_FUEL}%`,
      value: state.fuel,
      limit: MIN_FUEL,
      commandOrder: commandOrder ?? null,
    });
  }

  if (state.temperature < MIN_TEMPERATURE) {
    violations.push({
      code: "TEMPERATURE_BELOW_MINIMUM",
      message: `Temperature ${state.temperature} C is below the modeled minimum of ${MIN_TEMPERATURE} C`,
      value: state.temperature,
      limit: MIN_TEMPERATURE,
      commandOrder: commandOrder ?? null,
    });
  }

  if (state.temperature > MAX_TEMPERATURE) {
    violations.push({
      code: "TEMPERATURE_ABOVE_MAXIMUM",
      message: `Temperature ${state.temperature} C is above the modeled maximum of ${MAX_TEMPERATURE} C`,
      value: state.temperature,
      limit: MAX_TEMPERATURE,
      commandOrder: commandOrder ?? null,
    });
  }

  const definition = command && COMMAND_DEFINITIONS[command.type];
  if (
    definition?.requiresCommunication &&
    (state.radio === "OFF" || state.antenna !== "DEPLOYED")
  ) {
    violations.push({
      code: "COMMUNICATION_UNAVAILABLE",
      message: `${command.type} requires an available radio and deployed antenna`,
      commandOrder: commandOrder ?? null,
    });
  }

  return violations;
}

module.exports = { evaluateSafetyConstraints };