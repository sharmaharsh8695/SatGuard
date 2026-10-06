const { createCommandInstance } = require("../domain/commands/commandSchema");
const { COMMAND_STATUSES } = require("../domain/commands/commandStatus");
const { validateCommand } = require("../domain/commands/commandValidation");
const spacecraftService = require("./spacecraftService");

let commands = [];
let nextSequence = 1;

function enqueue(command, {
  preserveId = false,
  status = COMMAND_STATUSES.QUEUED,
  holdDetails,
} = {}) {
  const validation = validateCommand(command);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  if (![COMMAND_STATUSES.QUEUED, COMMAND_STATUSES.HELD].includes(status)) {
    return failure("INVALID_QUEUE_OPERATION", `Unsupported initial queue status: ${status}`);
  }

  if (
    preserveId &&
    commands.some((entry) => entry.id === validation.command.id)
  ) {
    return failure(
      "COMMAND_ID_CONFLICT",
      "A command with this ID already exists in the queue history",
    );
  }

  const queuedCommand = createCommandInstance({
    id: preserveId ? validation.command.id : undefined,
    type: validation.command.type,
    parameters: validation.command.parameters,
    status,
    sequence: nextSequence++,
  });

  if (status === COMMAND_STATUSES.HELD) {
    queuedCommand.holdDetails = structuredClone(holdDetails);
  }

  commands.push(queuedCommand);
  return { success: true, command: cloneCommand(queuedCommand) };
}

function getAll() {
  return commands
    .filter((command) => command.status === COMMAND_STATUSES.QUEUED)
    .map(cloneCommand);
}

function getHeld() {
  return commands
    .filter((command) => command.status === COMMAND_STATUSES.HELD)
    .map(cloneCommand);
}

function getById(id) {
  const command = commands.find((entry) => entry.id === id);
  return command ? cloneCommand(command) : null;
}

function cancel(id) {
  return updateStatus(id, COMMAND_STATUSES.CANCELLED);
}

function clear() {
  commands = [];
  nextSequence = 1;
}

function markExecuted(id) {
  return updateStatus(id, COMMAND_STATUSES.EXECUTED);
}

function markFailed(id) {
  return updateStatus(id, COMMAND_STATUSES.FAILED);
}

function execute(id) {
  const command = commands.find((entry) => entry.id === id);
  if (!command) {
    return failure("COMMAND_NOT_FOUND", `Command not found: ${id}`);
  }

  if (command.status !== COMMAND_STATUSES.QUEUED) {
    return statusFailure(command);
  }

  const execution = spacecraftService.executeCommand(command);
  const statusUpdate = execution.success ? markExecuted(id) : markFailed(id);

  if (!statusUpdate.success) {
    return statusUpdate;
  }

  return {
    ...execution,
    command: statusUpdate.command,
  };
}

function getSnapshot() {
  return getAll();
}

function updateStatus(id, status) {
  const command = commands.find((entry) => entry.id === id);
  if (!command) {
    return failure("COMMAND_NOT_FOUND", `Command not found: ${id}`);
  }

  if (command.status !== COMMAND_STATUSES.QUEUED) {
    return statusFailure(command);
  }

  command.status = status;
  return { success: true, command: cloneCommand(command) };
}

function statusFailure(command) {
  const errorByStatus = {
    [COMMAND_STATUSES.HELD]: ["COMMAND_ON_HOLD", "Command is held and cannot be executed"],
    [COMMAND_STATUSES.EXECUTED]: [
      "COMMAND_ALREADY_EXECUTED",
      "Command has already been executed",
    ],
    [COMMAND_STATUSES.CANCELLED]: [
      "COMMAND_ALREADY_CANCELLED",
      "Command has already been cancelled",
    ],
    [COMMAND_STATUSES.FAILED]: [
      "COMMAND_ALREADY_FAILED",
      "Command has already failed",
    ],
  };
  const [code, message] = errorByStatus[command.status] ?? [
    "INVALID_QUEUE_OPERATION",
    `Command cannot be changed from status ${command.status}`,
  ];

  return failure(code, message);
}

function failure(code, message) {
  return { success: false, error: { code, message } };
}

function cloneCommand(command) {
  return structuredClone(command);
}

module.exports = {
  enqueue,
  getAll,
  getHeld,
  getById,
  getSnapshot,
  cancel,
  clear,
  markExecuted,
  markFailed,
  execute,
};