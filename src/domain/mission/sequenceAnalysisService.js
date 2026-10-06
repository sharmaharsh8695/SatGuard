const { SUSPICIOUS_BURST_THRESHOLD, SUSPICIOUS_BURST_WINDOW_MS } = require("../../config/constants");
const { simulate } = require("../../services/consequenceSimulator");
const { planExecution } = require("../planning/executionPlanner");
const spacecraftService = require("../../services/spacecraftService");

function analyzeCommandSequence({ packets, currentState = spacecraftService.getState() } = {}) {
  if (!Array.isArray(packets) || packets.length === 0) {
    return {
      totalCommands: 0,
      commandTypes: [],
      repeatedCommandTypes: [],
      repeatedCommandFrequency: {},
      orderedCommandTypes: [],
      burstSignal: null,
      dependencyViolations: [],
      safe: true,
      consequence: { safe: true, initialState: currentState, finalState: currentState, violations: [] },
      planner: { status: "SAFE_AS_IS", safe: true },
      reason: "No commands were provided for sequence analysis",
    };
  }

  const commands = packets
    .filter((packet) => packet && packet.command)
    .map((packet) => structuredClone(packet.command));

  const commandTypes = commands.map((command) => command.type);
  const repeatedCommandFrequency = commandTypes.reduce((counts, type) => {
    counts[type] = (counts[type] ?? 0) + 1;
    return counts;
  }, {});

  const repeatedCommandTypes = Object.entries(repeatedCommandFrequency)
    .filter(([, count]) => count > 1)
    .map(([type, count]) => ({ type, count }));

  const consequence = simulate({ currentState, commands });
  const planner = planExecution({ currentState, commands });
  const burstSignal = analyzeBurstBehavior(packets);
  const dependencyViolations = planner.dependencyViolations ?? [];

  return {
    totalCommands: commands.length,
    commandTypes: commandTypes.slice(),
    repeatedCommandTypes,
    repeatedCommandFrequency,
    orderedCommandTypes: commandTypes.slice(),
    burstSignal,
    dependencyViolations,
    safe: consequence.safe && planner.safe,
    consequence,
    planner,
    reason: consequence.safe
      ? "Command sequence remains within modeled safety constraints"
      : "Sequence violates modeled consequences or planner dependencies",
  };
}

function analyzeBurstBehavior(packets) {
  const timestamps = packets
    .filter((packet) => packet && packet.command && typeof packet.command.timestamp === "string")
    .map((packet) => ({
      type: packet.command.type,
      timestamp: Date.parse(packet.command.timestamp),
    }))
    .filter((entry) => Number.isFinite(entry.timestamp));

  if (timestamps.length === 0) return null;

  const totalWindowCommands = timestamps.filter((entry, index) => {
    const current = entry.timestamp;
    const windowEntries = timestamps.slice(index).filter((candidate) => {
      return Math.abs(candidate.timestamp - current) <= SUSPICIOUS_BURST_WINDOW_MS;
    });
    return windowEntries.length > SUSPICIOUS_BURST_THRESHOLD;
  }).length;

  if (totalWindowCommands === 0) return null;

  return {
    type: "SUSPICIOUS_COMMAND_BURST",
    severity: "LOW",
    threshold: SUSPICIOUS_BURST_THRESHOLD,
    windowMs: SUSPICIOUS_BURST_WINDOW_MS,
    message: `Sequence contains more than ${SUSPICIOUS_BURST_THRESHOLD} commands inside the burst window`,
  };
}

module.exports = { analyzeCommandSequence };
