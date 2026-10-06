const { COMMAND_TYPES } = require("../commands/commandTypes");
const { simulate } = require("../../services/consequenceSimulator");

const MAX_PLANNED_COMMANDS = 5;

const DEPENDENCY_RULES = Object.freeze([
  Object.freeze({
    before: COMMAND_TYPES.CAMERA_ON,
    after: COMMAND_TYPES.CAPTURE_IMAGE,
  }),
  Object.freeze({
    before: COMMAND_TYPES.CAPTURE_IMAGE,
    after: COMMAND_TYPES.CAMERA_OFF,
  }),
]);

function planExecution({ currentState, commands } = {}) {
  if (!currentState || typeof currentState !== "object" || !Array.isArray(commands)) {
    return {
      status: "INVALID_INPUT",
      safe: false,
      reason: "Planning requires a spacecraft state object and a command array",
      originalOrder: [],
      plannedOrder: null,
      originalSimulation: null,
    };
  }

  const stateSnapshot = structuredClone(currentState);
  const originalCommands = structuredClone(commands);
  const originalSimulation = simulate({
    currentState: stateSnapshot,
    commands: originalCommands,
  });
  const originalOrder = describeOrder(originalCommands);
  const identityError = validateCommandIdentities(originalCommands);

  if (identityError) {
    return {
      status: "INVALID_INPUT",
      safe: false,
      reason: identityError,
      originalOrder,
      plannedOrder: null,
      originalSimulation,
    };
  }

  const originalDependencyViolations = findDependencyViolations(originalCommands);
  const currentOrderSafe =
    originalSimulation.safe && originalDependencyViolations.length === 0;

  if (originalCommands.length > MAX_PLANNED_COMMANDS) {
    return {
      status: "PLANNING_LIMIT_EXCEEDED",
      safe: currentOrderSafe,
      currentOrderSafe,
      reason: `Planning is limited to ${MAX_PLANNED_COMMANDS} commands; the current queue has ${originalCommands.length}`,
      originalOrder,
      plannedOrder: currentOrderSafe ? describeOrder(originalCommands) : null,
      originalSimulation,
      dependencyViolations: originalDependencyViolations,
      search: {
        performed: false,
        maxCommands: MAX_PLANNED_COMMANDS,
        queueSize: originalCommands.length,
      },
    };
  }

  if (currentOrderSafe) {
    return {
      status: "SAFE_AS_IS",
      safe: true,
      reason: "Current queue order is safe under modeled constraints",
      originalOrder,
      plannedOrder: describeOrder(originalCommands),
      originalSimulation,
      simulation: originalSimulation,
      dependencyRules: DEPENDENCY_RULES,
      search: { performed: false, maxCommands: MAX_PLANNED_COMMANDS },
    };
  }

  let candidateOrdersChecked = 0;
  let dependencyOrdersRejected = 0;
  let bestPlan = null;

  for (const candidate of permutations(originalCommands)) {
    const dependencyViolations = findDependencyViolations(candidate);
    if (dependencyViolations.length > 0) {
      dependencyOrdersRejected += 1;
      continue;
    }

    candidateOrdersChecked += 1;
    const candidateSimulation = sameOrder(candidate, originalCommands)
      ? originalSimulation
      : simulate({ currentState: stateSnapshot, commands: candidate });

    if (!candidateSimulation.safe) {
      continue;
    }

    const changes = changedPositions(originalCommands, candidate);
    if (!bestPlan || changes < bestPlan.changes) {
      bestPlan = { commands: candidate, simulation: candidateSimulation, changes };
    }
  }

  const search = {
    performed: true,
    maxCommands: MAX_PLANNED_COMMANDS,
    candidatesChecked: candidateOrdersChecked,
    dependencyOrdersRejected,
    selection: "fewest changed positions, then first candidate in stable enumeration order",
  };

  if (!bestPlan) {
    return {
      status: "NO_SAFE_PLAN",
      safe: false,
      reason: "No dependency-respecting command order is safe under modeled constraints",
      originalOrder,
      plannedOrder: null,
      originalSimulation,
      violations: originalSimulation.violations,
      executionFailure: originalSimulation.executionFailure,
      dependencyViolations: originalDependencyViolations,
      dependencyRules: DEPENDENCY_RULES,
      search,
    };
  }

  return {
    status: "SAFE_REORDER_FOUND",
    safe: true,
    reason: explainOriginalFailure(originalSimulation, originalDependencyViolations),
    originalOrder,
    plannedOrder: describeOrder(bestPlan.commands),
    originalSimulation,
    simulation: bestPlan.simulation,
    predictedFinalState: bestPlan.simulation.finalState,
    violations: originalSimulation.violations,
    executionFailure: originalSimulation.executionFailure,
    dependencyViolations: originalDependencyViolations,
    dependencyRules: DEPENDENCY_RULES,
    changes: bestPlan.changes,
    search,
  };
}

function validateCommandIdentities(commands) {
  if (!Array.isArray(commands)) {
    return "Commands must be an array";
  }

  const ids = new Set();
  for (const command of commands) {
    if (!command || typeof command.id !== "string" || command.id.length === 0) {
      return "Every planned command must have a non-empty string ID";
    }
    if (ids.has(command.id)) {
      return `Duplicate command ID: ${command.id}`;
    }
    ids.add(command.id);
  }

  return null;
}

function findDependencyViolations(commands) {
  const positions = new Map(commands.map((command, index) => [command.id, index]));
  const violations = [];

  for (const rule of DEPENDENCY_RULES) {
    const beforeCommands = commands.filter((command) => command.type === rule.before);
    const afterCommands = commands.filter((command) => command.type === rule.after);

    for (const beforeCommand of beforeCommands) {
      for (const afterCommand of afterCommands) {
        if (positions.get(beforeCommand.id) >= positions.get(afterCommand.id)) {
          violations.push({
            beforeCommandId: beforeCommand.id,
            beforeType: rule.before,
            afterCommandId: afterCommand.id,
            afterType: rule.after,
          });
        }
      }
    }
  }

  return violations;
}

function* permutations(commands, used = new Set(), ordered = []) {
  if (ordered.length === commands.length) {
    yield [...ordered];
    return;
  }

  for (let index = 0; index < commands.length; index += 1) {
    if (used.has(index)) {
      continue;
    }

    used.add(index);
    ordered.push(commands[index]);
    yield* permutations(commands, used, ordered);
    ordered.pop();
    used.delete(index);
  }
}

function changedPositions(original, candidate) {
  return original.reduce(
    (changes, command, index) => changes + Number(command.id !== candidate[index].id),
    0,
  );
}

function sameOrder(first, second) {
  return first.every((command, index) => command.id === second[index].id);
}

function describeOrder(commands) {
  return commands.map((command) => {
    if (!command || typeof command !== "object") {
      return { id: null, type: null };
    }

    return {
      id: command.id ?? null,
      type: command.type ?? null,
      ...(command.sequence === undefined ? {} : { sequence: command.sequence }),
    };
  });
}

function explainOriginalFailure(simulation, dependencyViolations) {
  if (simulation.executionFailure) {
    return `Original order failed at command ${simulation.executionFailure.commandOrder}: ${simulation.executionFailure.error.message}`;
  }

  if (simulation.violations.length > 0) {
    return `Original order violates modeled constraints: ${simulation.violations[0].message}`;
  }

  if (dependencyViolations.length > 0) {
    const violation = dependencyViolations[0];
    return `Original order violates dependency: ${violation.beforeType} must precede ${violation.afterType}`;
  }

  return "Original order is not valid under the planner rules";
}

module.exports = { planExecution, MAX_PLANNED_COMMANDS, DEPENDENCY_RULES };