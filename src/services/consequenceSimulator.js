const { transitionCommand } = require("../domain/spacecraft/commandExecutor");
const { evaluateSafetyConstraints } = require("../domain/safety/safetyConstraints");
const { validateCommand } = require("../domain/commands/commandValidation");

function simulate({ currentState, commands }) {
  const initialState = structuredClone(currentState);
  const simulationCommands = structuredClone(commands);
  let simulatedState = structuredClone(initialState);
  const steps = [];
  const violations = evaluateSafetyConstraints(initialState);
  let executionFailure = null;

  for (const [index, command] of simulationCommands.entries()) {
    const order = index + 1;
    const validation = validateCommand(command);
    const displayCommand = command && typeof command === "object"
      ? { id: command.id ?? null, type: command.type ?? null }
      : { id: null, type: null };
    if (Number.isInteger(command?.sequence)) {
      displayCommand.sequence = command.sequence;
    }

    if (!validation.valid) {
      executionFailure = {
        commandOrder: order,
        command: displayCommand,
        error: validation.error,
      };
      steps.push({
        order,
        command: displayCommand,
        success: false,
        error: validation.error,
        state: structuredClone(simulatedState),
        violations: [],
      });
      break;
    }

    const priorStateViolations = evaluateSafetyConstraints(simulatedState);
    const transition = transitionCommand(simulatedState, validation.command);
    if (!transition.success) {
      const stepViolations = newlyIntroducedViolations(
        evaluateSafetyConstraints(
        simulatedState,
        validation.command,
        order,
        ),
        priorStateViolations,
      );
      appendViolations(violations, stepViolations);
      executionFailure = {
        commandOrder: order,
        command: displayCommand,
        error: transition.error,
      };
      steps.push({
        order,
        command: displayCommand,
        success: false,
        error: transition.error,
        state: structuredClone(simulatedState),
        violations: stepViolations,
      });
      break;
    }

    simulatedState = structuredClone(transition.state);
    const stepViolations = newlyIntroducedViolations(
      evaluateSafetyConstraints(simulatedState, validation.command, order),
      priorStateViolations,
    );
    appendViolations(violations, stepViolations);
    steps.push({
      order,
      command: displayCommand,
      success: true,
      result: transition.result,
      state: structuredClone(simulatedState),
      violations: stepViolations,
    });
  }

  return {
    safe: violations.length === 0 && executionFailure === null,
    initialState,
    finalState: structuredClone(simulatedState),
    steps,
    violations,
    firstViolation: violations[0] ?? null,
    firstViolationCommand:
      violations.find((violation) => violation.commandOrder !== null) ?? null,
    executionFailure,
    stoppedEarly: executionFailure !== null,
  };
}

function newlyIntroducedViolations(currentViolations, priorViolations) {
  return currentViolations.filter((violation) => {
    const priorViolation = priorViolations.find((item) => item.code === violation.code);
    if (!priorViolation) {
      return true;
    }

    if (
      violation.code === "BATTERY_BELOW_MINIMUM" ||
      violation.code === "FUEL_BELOW_MINIMUM" ||
      violation.code === "TEMPERATURE_BELOW_MINIMUM"
    ) {
      return violation.value < priorViolation.value;
    }

    if (violation.code === "TEMPERATURE_ABOVE_MAXIMUM") {
      return violation.value > priorViolation.value;
    }

    return false;
  });
}

function appendViolations(allViolations, newViolations) {
  for (const violation of newViolations) {
    const alreadyRecorded = allViolations.some(
      (existing) =>
        existing.code === violation.code &&
        existing.commandOrder === violation.commandOrder,
    );
    if (!alreadyRecorded) {
      allViolations.push(violation);
    }
  }
}

module.exports = { simulate };