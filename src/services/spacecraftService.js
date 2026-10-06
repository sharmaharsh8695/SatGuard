const { createInitialSpacecraftState } = require("../domain/spacecraft/spacecraftState");
const { transitionCommand } = require("../domain/spacecraft/commandExecutor");
const { validateCommand } = require("../domain/commands/commandValidation");

let currentState = createInitialSpacecraftState();

function getState() {
  return { ...currentState };
}

function executeCommand(command) {
  const validation = validateCommand(command);
  if (!validation.valid) {
    return {
      success: false,
      command: { type: command?.type },
      error: validation.error,
      state: getState(),
    };
  }

  const execution = transitionCommand(currentState, validation.command);
  if (execution.success) {
    currentState = execution.state;
  }

  return {
    ...execution,
    command: { type: validation.command.type },
  };
}

function resetState() {
  currentState = createInitialSpacecraftState();
  return getState();
}

module.exports = { getState, executeCommand, resetState };