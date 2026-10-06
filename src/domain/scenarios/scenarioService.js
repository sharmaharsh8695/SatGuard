const {
  PROTOTYPE_OPERATORS,
  SUSPICIOUS_BURST_THRESHOLD,
  SERIOUS_EVENTS_FOR_RESTRICTED,
  SERIOUS_EVENTS_FOR_SAFE_MODE,
} = require("../../config/constants");
const { COMMAND_TYPES } = require("../commands/commandTypes");
const { calculateCommandSignature } = require("../security/commandIntegrity");
const { evaluateCommand } = require("../security/decisionEngine");
const { clearReplayState } = require("../security/replayProtection");
const { clearPolicyState } = require("../security/securityPolicy");
const commandQueueService = require("../../services/commandQueueService");
const spacecraftService = require("../../services/spacecraftService");
const incidentService = require("../../services/incidentService");
const quarantineService = require("../../services/quarantineService");

const SCENARIOS = Object.freeze([
  {
    id: "normal_safe_command",
    name: "NORMAL_SAFE_COMMAND",
    title: "Legitimate safe command",
    description: "A valid operator submits a safe PING command.",
    category: "NORMAL",
    expectedBehavior: "Security passes and the command is allowed without execution.",
  },
  {
    id: "tampered_command",
    name: "TAMPERED_COMMAND",
    title: "Command modified after signing",
    description: "A command type is changed after its HMAC has been created.",
    category: "INTEGRITY",
    expectedBehavior: "Integrity fails and the request is quarantined.",
  },
  {
    id: "replayed_command",
    name: "REPLAYED_COMMAND",
    title: "Previously accepted command replayed",
    description: "The same signed command ID and nonce are submitted twice.",
    category: "REPLAY",
    expectedBehavior: "The first request is accepted and the replay is quarantined.",
  },
  {
    id: "legitimate_but_unsafe",
    name: "LEGITIMATE_BUT_UNSAFE",
    title: "Valid command with unsafe current order",
    description: "A valid CAMERA_ON request can safely precede an already queued capture.",
    category: "OPERATIONAL_SAFETY",
    expectedBehavior: "Security passes, a safe reorder is found, and the command is held.",
  },
  {
    id: "no_safe_plan",
    name: "NO_SAFE_PLAN",
    title: "Unsafe sequence with no valid reorder",
    description: "A camera-off proposal cannot repair a capture that requires the camera on.",
    category: "PLANNING",
    expectedBehavior: "No safe plan is found and the command is quarantined.",
  },
  {
    id: "command_burst",
    name: "COMMAND_BURST",
    title: "Rapid command burst",
    description: "One prototype operator submits the configured burst threshold plus one.",
    category: "BEHAVIORAL",
    expectedBehavior: "The threshold-crossing command receives WATCH and a burst signal.",
  },
  {
    id: "escalation_to_restricted",
    name: "ESCALATION_TO_RESTRICTED",
    title: "Repeated serious security events",
    description: "Repeated authentication failures restrict an operator's normal commands.",
    category: "ESCALATION",
    expectedBehavior: "PING is restricted while an explicitly permitted CAMERA_OFF remains available.",
  },
  {
    id: "critical_escalation_to_safe_mode",
    name: "CRITICAL_ESCALATION_TO_SAFE_MODE",
    title: "Critical replay after serious events",
    description: "A replay follows the configured number of serious integrity events.",
    category: "ESCALATION",
    expectedBehavior: "The existing policy selects SAFE_MODE and invokes its simulated transition.",
  },
]);

const SCENARIO_BY_ID = new Map(SCENARIOS.map((scenario) => [scenario.id, scenario]));

function listScenarios() {
  return SCENARIOS.map((scenario) => structuredClone(scenario));
}

function resetDemoState() {
  spacecraftService.resetState();
  commandQueueService.clear();
  clearReplayState();
  clearPolicyState();
  incidentService.clear();
  quarantineService.clear();

  return {
    reset: true,
    scope: "Local SAT Guard demo/test state only",
    spacecraft: spacecraftService.getState(),
    queue: { pending: [], held: [] },
    events: [],
    quarantine: [],
  };
}

function runScenario(scenarioId) {
  const scenario = SCENARIO_BY_ID.get(scenarioId);
  if (!scenario) return null;

  resetDemoState();
  const execution = runScenarioById(scenarioId);
  const verification = verifyScenario(scenarioId, execution.result);

  return {
    scenario: structuredClone(scenario),
    result: execution.result,
    context: execution.context ?? null,
    verification,
    events: incidentService.getEvents(),
    spacecraft: spacecraftService.getState(),
    queue: {
      pending: commandQueueService.getSnapshot(),
      held: commandQueueService.getHeld(),
    },
    quarantine: quarantineService.getAll(),
  };
}

function runScenarioById(scenarioId) {
  switch (scenarioId) {
    case "normal_safe_command":
      return { result: evaluateCommand(createEnvelope("operator-1", "demo-normal-ping", COMMAND_TYPES.PING)) };
    case "tampered_command": {
      const envelope = createEnvelope("operator-1", "demo-tampered-camera", COMMAND_TYPES.CAMERA_ON);
      envelope.command.type = COMMAND_TYPES.CAMERA_OFF;
      return { result: evaluateCommand(envelope) };
    }
    case "replayed_command": {
      const envelope = createEnvelope("operator-1", "demo-replayed-ping", COMMAND_TYPES.PING);
      return {
        result: {
          firstSubmission: evaluateCommand(envelope),
          replaySubmission: evaluateCommand(envelope),
        },
      };
    }
    case "legitimate_but_unsafe":
      return runCameraPreparationScenario(COMMAND_TYPES.CAMERA_ON, "demo-unsafe-camera-on");
    case "no_safe_plan":
      return runCameraPreparationScenario(COMMAND_TYPES.CAMERA_OFF, "demo-no-plan-camera-off");
    case "command_burst":
      return runCommandBurstScenario();
    case "escalation_to_restricted":
      return runRestrictedEscalationScenario();
    case "critical_escalation_to_safe_mode":
      return runSafeModeEscalationScenario();
    default:
      return { result: null };
  }
}

function runCameraPreparationScenario(proposedType, proposedId) {
  const cameraOn = spacecraftService.executeCommand({ type: COMMAND_TYPES.CAMERA_ON });
  const capture = evaluateCommand(
    createEnvelope("operator-1", "demo-pending-capture", COMMAND_TYPES.CAPTURE_IMAGE),
  );
  const cameraOff = spacecraftService.executeCommand({ type: COMMAND_TYPES.CAMERA_OFF });
  const decision = evaluateCommand(createEnvelope("operator-1", proposedId, proposedType));

  return {
    result: decision,
    context: {
      preparation: {
        cameraOn: cameraOn.success,
        captureAdmissionDecision: capture.decision,
        cameraOff: cameraOff.success,
        pendingCommandId: commandQueueService.getSnapshot()[0]?.id ?? null,
      },
    },
  };
}

function runCommandBurstScenario() {
  const submissions = [];
  for (let index = 1; index <= SUSPICIOUS_BURST_THRESHOLD + 1; index += 1) {
    submissions.push(
      evaluateCommand(
        createEnvelope("operator-2", `demo-burst-${index}`, COMMAND_TYPES.PING),
      ),
    );
  }
  return { result: { submissions }, context: { thresholdCrossingSubmission: submissions.length } };
}

function runRestrictedEscalationScenario() {
  const operatorId = "operator-1";
  const seriousEvents = [];
  for (let index = 1; index <= SERIOUS_EVENTS_FOR_RESTRICTED; index += 1) {
    const envelope = createEnvelope(operatorId, `demo-restrict-auth-${index}`, COMMAND_TYPES.PING);
    envelope.credential = "invalid-demo-credential";
    seriousEvents.push(evaluateCommand(envelope));
  }

  const restrictedPing = evaluateCommand(
    createEnvelope(operatorId, "demo-restricted-ping", COMMAND_TYPES.PING),
  );
  const permittedSafetyCommand = evaluateCommand(
    createEnvelope(operatorId, "demo-restricted-camera-off", COMMAND_TYPES.CAMERA_OFF),
  );

  return {
    result: { seriousEvents, restrictedPing, permittedSafetyCommand },
    context: { seriousEventThreshold: SERIOUS_EVENTS_FOR_RESTRICTED },
  };
}

function runSafeModeEscalationScenario() {
  const operatorId = "admin";
  const seriousEvents = [];
  for (let index = 1; index <= SERIOUS_EVENTS_FOR_SAFE_MODE; index += 1) {
    const envelope = createEnvelope(operatorId, `demo-safe-integrity-${index}`, COMMAND_TYPES.PING);
    envelope.signature = "f".repeat(64);
    seriousEvents.push(evaluateCommand(envelope));
  }

  const replayEnvelope = createEnvelope(
    operatorId,
    "demo-critical-replay",
    COMMAND_TYPES.PING,
  );
  const firstSubmission = evaluateCommand(replayEnvelope);
  const replaySubmission = evaluateCommand(replayEnvelope);

  return {
    result: { seriousEvents, firstSubmission, replaySubmission },
    context: { seriousEventThreshold: SERIOUS_EVENTS_FOR_SAFE_MODE },
  };
}

function createEnvelope(operatorId, id, type, parameters = {}) {
  const operator = PROTOTYPE_OPERATORS[operatorId];
  const command = {
    id,
    type,
    parameters,
    timestamp: new Date().toISOString(),
    nonce: `demo-nonce-${id}`,
  };

  return {
    operatorId,
    credential: operator.authToken,
    command,
    signature: calculateCommandSignature(command, operatorId, operator.hmacSecret),
  };
}

function verifyScenario(scenarioId, result) {
  let checks;
  switch (scenarioId) {
    case "normal_safe_command":
      checks = [{ name: "decision is ALLOW", passed: result.decision === "ALLOW" }];
      break;
    case "tampered_command":
      checks = [
        { name: "integrity failed", passed: result.security.checks.integrity.passed === false },
        { name: "decision is QUARANTINE", passed: result.decision === "QUARANTINE" },
      ];
      break;
    case "replayed_command":
      checks = [
        { name: "first submission allowed", passed: result.firstSubmission.decision === "ALLOW" },
        { name: "second submission detects replay", passed: hasSignal(result.replaySubmission, "REPLAY_DETECTED") },
      ];
      break;
    case "legitimate_but_unsafe":
      checks = [
        { name: "all security checks pass", passed: securityChecksPassed(result) },
        { name: "consequence is unsafe", passed: result.consequence?.safe === false },
        { name: "safe reorder found", passed: result.planner?.status === "SAFE_REORDER_FOUND" },
        { name: "decision is HOLD", passed: result.decision === "HOLD" },
      ];
      break;
    case "no_safe_plan":
      checks = [
        { name: "all security checks pass", passed: securityChecksPassed(result) },
        { name: "consequence is unsafe", passed: result.consequence?.safe === false },
        { name: "planner reports no safe plan", passed: result.planner?.status === "NO_SAFE_PLAN" },
        { name: "decision is QUARANTINE", passed: result.decision === "QUARANTINE" },
      ];
      break;
    case "command_burst": {
      const last = result.submissions.at(-1);
      checks = [
        { name: "threshold crossing has burst signal", passed: hasSignal(last, "SUSPICIOUS_COMMAND_BURST") },
        { name: "decision is WATCH", passed: last.decision === "WATCH" },
      ];
      break;
    }
    case "escalation_to_restricted":
      checks = [
        { name: "threshold event reaches RESTRICTED", passed: result.seriousEvents.at(-1)?.decision === "RESTRICTED" },
        { name: "PING is restricted", passed: result.restrictedPing.decision === "RESTRICTED" },
        { name: "CAMERA_OFF remains available", passed: result.permittedSafetyCommand.decision === "ALLOW" },
      ];
      break;
    case "critical_escalation_to_safe_mode":
      checks = [
        { name: "serious events were generated", passed: result.seriousEvents.length === SERIOUS_EVENTS_FOR_SAFE_MODE },
        { name: "critical replay reaches SAFE_MODE", passed: result.replaySubmission.decision === "SAFE_MODE" },
        { name: "simulated SAFE mode was invoked", passed: result.replaySubmission.safeModeAction?.success === true },
      ];
      break;
    default:
      checks = [{ name: "scenario is known", passed: false }];
  }

  return { passed: checks.every((check) => check.passed), checks };
}

function securityChecksPassed(result) {
  return ["authentication", "authorization", "integrity", "replay"]
    .every((check) => result.security.checks[check].passed === true);
}

function hasSignal(result, type) {
  return result.signals.some((signal) => signal.type === type);
}

module.exports = { listScenarios, resetDemoState, runScenario };