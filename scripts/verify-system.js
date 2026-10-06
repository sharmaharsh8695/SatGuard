const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { PROTOTYPE_OPERATORS } = require("../src/config/constants");
const { COMMAND_TYPES } = require("../src/domain/commands/commandTypes");
const { calculateCommandSignature } = require("../src/domain/security/commandIntegrity");

const ROOT = path.resolve(__dirname, "..");
const REPORT_PATH = path.join(ROOT, "verification", "results", "verification-results.json");
const REQUEST_TIMEOUT_MS = 2500;
const STARTUP_TIMEOUT_MS = 12000;
const CHILD_LOG_LIMIT = 40;
const checks = [];
const coveredEndpoints = new Set();
const knownSecrets = Object.values(PROTOTYPE_OPERATORS).flatMap((operator) => [
  operator.authToken,
  operator.hmacSecret,
]);

const ENDPOINT_MANIFEST = [
  ["GET", "/health", false, false],
  ["GET", "/spacecraft/state", false, false],
  ["POST", "/spacecraft/commands", false, true],
  ["GET", "/commands/queue", false, false],
  ["GET", "/commands/held", false, false],
  ["POST", "/commands/queue", false, true],
  ["GET", "/commands/queue/:id", false, false],
  ["DELETE", "/commands/queue/:id", false, true],
  ["POST", "/commands/queue/:id/execute", false, true],
  ["GET", "/commands/queue/simulation", false, false],
  ["POST", "/commands/queue/simulation", false, false],
  ["GET", "/commands/queue/plan", false, false],
  ["POST", "/commands/queue/plan", false, false],
  ["POST", "/gateway/commands", true, true],
  ["POST", "/gateway/commands/evaluate", true, true],
  ["GET", "/security/events", false, false],
  ["GET", "/security/quarantine", false, false],
  ["GET", "/scenarios", false, false],
  ["POST", "/scenarios/reset", false, true],
  ["POST", "/scenarios/:scenarioId/run", false, true],
];

let baseUrl = null;
let backendProcess = null;
let backendExit = null;
let shutdownRequested = false;
let commandOrdinal = 0;
let serverOutput = [];
let secretLeakFound = false;
let sensitiveFieldLeakFound = false;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function redact(value) {
  let text = String(value ?? "");
  for (const secret of knownSecrets) {
    if (secret) text = text.split(secret).join("[REDACTED]");
  }
  return text.replace(/\b[a-f0-9]{64}\b/gi, "[REDACTED SIGNATURE]");
}

function safeTail(lines) {
  return lines.slice(-CHILD_LOG_LIMIT).map(redact);
}

function recordCheck({ id, subsystem, description, expected, actual, status, durationMs = 0, critical = true }) {
  checks.push({
    id,
    subsystem,
    description,
    expected: redact(expected),
    actual: redact(actual),
    status,
    durationMs: Math.max(0, Math.round(durationMs)),
    critical,
  });
}

async function verify(id, subsystem, description, expected, action, options = {}) {
  const started = Date.now();
  try {
    const outcome = await action();
    const passed = Boolean(outcome.pass);
    recordCheck({
      id,
      subsystem,
      description,
      expected,
      actual: outcome.actual,
      status: passed ? "PASS" : "FAIL",
      durationMs: Date.now() - started,
      critical: options.critical !== false,
    });
    return outcome.value;
  } catch (error) {
    recordCheck({
      id,
      subsystem,
      description,
      expected,
      actual: redact(error?.message ?? "Verification action failed"),
      status: "FAIL",
      durationMs: Date.now() - started,
      critical: options.critical !== false,
    });
    return undefined;
  }
}

function skip(id, subsystem, description, reason) {
  recordCheck({
    id,
    subsystem,
    description,
    expected: "Public HTTP API can configure the required condition",
    actual: reason,
    status: "SKIP",
    critical: false,
  });
}

function assertJson(response) {
  assert.equal(response.jsonValid, true, `Expected JSON response; received HTTP ${response.status}`);
  assert.ok(response.json && typeof response.json === "object", "Expected a JSON object or array");
  return response.json;
}

function assertStatus(response, statuses) {
  assert.ok(statuses.includes(response.status), `Expected HTTP ${statuses.join(" or ")}; received ${response.status}`);
  return response.json;
}

function trackEndpoint(method, requestPath) {
  const actual = requestPath.split("?")[0];
  const staticEntry = ENDPOINT_MANIFEST.find(([expectedMethod, pattern]) =>
    expectedMethod === method && !pattern.includes(":") && pattern === actual,
  );
  if (staticEntry) {
    coveredEndpoints.add(`${method} ${staticEntry[1]}`);
    return;
  }

  for (const [expectedMethod, pattern] of ENDPOINT_MANIFEST) {
    if (expectedMethod !== method) continue;
    const expression = new RegExp(`^${pattern.split("/").map((part) => part.startsWith(":") ? "[^/]+" : escapeRegExp(part)).join("/")}$`);
    if (expression.test(actual)) {
      coveredEndpoints.add(`${method} ${pattern}`);
      return;
    }
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function request(method, requestPath, options = {}) {
  trackEndpoint(method, requestPath);
  const fetchOptions = {
    method,
    headers: options.headers ?? {},
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  };
  if (options.json !== undefined) {
    fetchOptions.headers["content-type"] = "application/json";
    fetchOptions.body = JSON.stringify(options.json);
  } else if (options.rawBody !== undefined) {
    fetchOptions.body = options.rawBody;
  }

  const response = await fetch(`${baseUrl}${requestPath}`, fetchOptions);
  const raw = await response.text();
  let json = null;
  let jsonValid = false;
  try {
    json = JSON.parse(raw);
    jsonValid = true;
  } catch {
    // Keep raw response private; checks only record safe summaries.
  }

  if (knownSecrets.some((secret) => secret && raw.includes(secret))) {
    secretLeakFound = true;
  }
  if (jsonValid && containsSensitiveField(json)) {
    sensitiveFieldLeakFound = true;
  }

  return { status: response.status, json, jsonValid, raw };
}

function command(type, parameters = {}) {
  return { type, parameters };
}

function nextId(label) {
  commandOrdinal += 1;
  return `verify-m10-${label}-${String(commandOrdinal).padStart(3, "0")}`;
}

function createEnvelope(operatorId, type, parameters = {}, overrides = {}) {
  const operator = PROTOTYPE_OPERATORS[operatorId];
  if (!operator) throw new Error("Verifier configuration is missing a prototype operator");
  const id = overrides.id ?? nextId("command");
  const timestamp = overrides.timestamp ?? new Date().toISOString();
  const nonce = overrides.nonce ?? `${id}-nonce`;
  const payload = { id, type, parameters, timestamp, nonce };
  return {
    operatorId,
    credential: overrides.credential ?? operator.authToken,
    command: payload,
    signature: overrides.signature ?? calculateCommandSignature(payload, operatorId, operator.hmacSecret),
  };
}

async function resetDemo() {
  const response = await request("POST", "/scenarios/reset", { json: {} });
  assertStatus(response, [200]);
  return response.json;
}

async function readSpacecraft() {
  const response = await request("GET", "/spacecraft/state");
  assertStatus(response, [200]);
  assertJson(response);
  return response.json.state;
}

async function readQueue() {
  const response = await request("GET", "/commands/queue");
  assertStatus(response, [200]);
  assertJson(response);
  return response.json.commands;
}

function sameJson(first, second) {
  return JSON.stringify(first) === JSON.stringify(second);
}

async function verifyHealthAndBasicApi() {
  await verify("HEALTH-001", "health", "Health returns the SAT Guard service identity", "HTTP 200 JSON; status ok; service SAT Guard", async () => {
    const response = await request("GET", "/health");
    const data = assertStatus(response, [200]);
    assertJson(response);
    assert.equal(data.status, "ok");
    assert.equal(data.service, "SAT Guard");
    return { pass: true, actual: `HTTP ${response.status}; status=${data.status}; service=${data.service}` };
  });

  await verify("HEALTH-002", "health", "Malformed request body returns safe JSON instead of crashing", "HTTP 400 JSON error without stack", async () => {
    const response = await request("POST", "/spacecraft/commands", {
      rawBody: "{invalid-json",
      headers: { "content-type": "application/json" },
    });
    assert.equal(response.status, 400);
    const data = assertJson(response);
    assert.ok(data.error?.code);
    assert.equal(Object.hasOwn(data, "stack"), false);
    return { pass: true, actual: `HTTP ${response.status}; JSON error returned; stack absent` };
  });
}

async function verifySpacecraftAndValidation() {
  const baseline = await verify("SPACECRAFT-001", "spacecraft", "Initial state contains sensible modeled fields", "HTTP 200 with nominal state and required state fields", async () => {
    const response = await request("GET", "/spacecraft/state");
    const data = assertStatus(response, [200]);
    assertJson(response);
    const state = data.state;
    for (const field of ["mode", "battery", "fuel", "temperature", "orientation", "camera", "radio", "antenna", "missionPhase"]) {
      assert.ok(Object.hasOwn(state, field), `Missing spacecraft field ${field}`);
    }
    assert.ok(state.battery >= 0 && state.battery <= 100);
    assert.ok(state.fuel >= 0 && state.fuel <= 100);
    assert.equal(state.mode, "NOMINAL");
    return { pass: true, actual: `HTTP ${response.status}; mode=${state.mode}; battery/fuel within modeled 0-100 ranges` , value: state };
  });

  await verify("SPACECRAFT-002", "spacecraft", "PING succeeds without changing state", "HTTP 200; success true; state unchanged", async () => {
    const before = await readSpacecraft();
    const response = await request("POST", "/spacecraft/commands", { json: command(COMMAND_TYPES.PING) });
    const result = assertStatus(response, [200]);
    assertJson(response);
    const after = await readSpacecraft();
    assert.equal(result.success, true);
    assert.ok(sameJson(before, after));
    return { pass: true, actual: `HTTP ${response.status}; success; state unchanged` };
  });

  const directSequence = [
    ["SPACECRAFT-003", COMMAND_TYPES.CAMERA_ON, {}, (state) => state.camera === "ON"],
    ["SPACECRAFT-004", COMMAND_TYPES.CAPTURE_IMAGE, {}, (state) => state.imagesCaptured === 1],
    ["SPACECRAFT-005", COMMAND_TYPES.CAMERA_OFF, {}, (state) => state.camera === "OFF"],
    ["SPACECRAFT-006", COMMAND_TYPES.HIGH_POWER_TRANSMISSION, {}, (state) => state.battery === baseline.battery - 5],
    ["SPACECRAFT-007", COMMAND_TYPES.HEATER_ON, {}, (state) => state.heater === "ON"],
    ["SPACECRAFT-008", COMMAND_TYPES.HEATER_OFF, {}, (state) => state.heater === "OFF"],
    ["SPACECRAFT-009", COMMAND_TYPES.CHANGE_ORIENTATION, { orientation: "ZENITH" }, (state) => state.orientation === "ZENITH"],
    ["SPACECRAFT-010", COMMAND_TYPES.ENTER_SAFE_MODE, {}, (state) => state.mode === "SAFE"],
    ["SPACECRAFT-011", COMMAND_TYPES.RECOVER, {}, (state) => state.mode === "NOMINAL"],
  ];

  for (const [id, type, parameters, predicate] of directSequence) {
    await verify(id, "spacecraft", `${type} follows the existing simulator transition`, "HTTP 200; command succeeds and expected field changes", async () => {
      const response = await request("POST", "/spacecraft/commands", { json: command(type, parameters) });
      const result = assertStatus(response, [200]);
      assertJson(response);
      assert.equal(result.success, true);
      const state = await readSpacecraft();
      assert.equal(predicate(state), true);
      return { pass: true, actual: `HTTP ${response.status}; success; modeled transition observed` };
    });
  }

  await resetDemo();
  await verify("SPACECRAFT-012", "spacecraft", "Precondition failure does not partially mutate state", "Capture with camera off is rejected; before/after state equal", async () => {
    const before = await readSpacecraft();
    const response = await request("POST", "/spacecraft/commands", { json: command(COMMAND_TYPES.CAPTURE_IMAGE) });
    assert.equal(response.status, 409);
    const data = assertJson(response);
    const after = await readSpacecraft();
    assert.equal(data.success, false);
    assert.ok(sameJson(before, after));
    return { pass: true, actual: `HTTP ${response.status}; rejected; state unchanged` };
  });

  const invalidDirect = [
    ["VALIDATION-001", "Missing command type", {}],
    ["VALIDATION-002", "Unknown command type", { type: "VERIFY_UNKNOWN_COMMAND" }],
    ["VALIDATION-003", "Malformed parameters", { type: COMMAND_TYPES.CHANGE_ORIENTATION, parameters: [] }],
    ["VALIDATION-004", "Invalid parameter value", command(COMMAND_TYPES.CHANGE_ORIENTATION, { orientation: "INVALID" })],
    ["VALIDATION-005", "Invalid command structure", null],
  ];
  for (const [id, description, payload] of invalidDirect) {
    await verify(id, "validation", description, "HTTP 4xx; JSON rejection; state unchanged", async () => {
      const before = await readSpacecraft();
      const response = await request("POST", "/spacecraft/commands", { json: payload });
      assert.ok(response.status >= 400 && response.status < 500);
      const data = assertJson(response);
      assert.equal(data.success, false);
      assert.ok(sameJson(before, await readSpacecraft()));
      return { pass: true, actual: `HTTP ${response.status}; rejected; state unchanged` };
    });
  }
}

async function verifyQueue() {
  await resetDemo();
  await verify("QUEUE-001", "queue", "Queue starts clean after demo reset", "GET queue returns empty array", async () => {
    const commands = await readQueue();
    assert.deepEqual(commands, []);
    return { pass: true, actual: "HTTP 200; pending queue empty" };
  });

  const first = await request("POST", "/commands/queue", { json: command(COMMAND_TYPES.CAMERA_ON) });
  const second = await request("POST", "/commands/queue", { json: command(COMMAND_TYPES.PING) });
  await verify("QUEUE-002", "queue", "Valid commands enqueue once in insertion order", "Two commands with distinct IDs and increasing sequence", async () => {
    assertStatus(first, [202]);
    assertStatus(second, [202]);
    const firstCommand = assertJson(first).command;
    const secondCommand = assertJson(second).command;
    const commands = await readQueue();
    assert.notEqual(firstCommand.id, secondCommand.id);
    assert.equal(commands.filter((item) => item.id === firstCommand.id).length, 1);
    assert.deepEqual(commands.map((item) => item.id), [firstCommand.id, secondCommand.id]);
    assert.ok(commands[0].sequence < commands[1].sequence);
    return { pass: true, actual: `Two distinct commands appear once in insertion order` };
  });

  const firstId = first.json?.command?.id;
  const secondId = second.json?.command?.id;
  await verify("QUEUE-003", "queue", "Fetch queued command by returned ID", "HTTP 200 and matching command ID", async () => {
    assert.ok(firstId);
    const response = await request("GET", `/commands/queue/${encodeURIComponent(firstId)}`);
    const data = assertStatus(response, [200]);
    assertJson(response);
    assert.equal(data.command.id, firstId);
    return { pass: true, actual: `HTTP ${response.status}; command ID matched` };
  });

  await verify("QUEUE-004", "queue", "Cancellation changes status and removes from pending list", "DELETE succeeds; status CANCELLED; pending item removed", async () => {
    const response = await request("DELETE", `/commands/queue/${encodeURIComponent(secondId)}`);
    const data = assertStatus(response, [200]);
    assertJson(response);
    assert.equal(data.command.status, "CANCELLED");
    assert.equal((await readQueue()).some((item) => item.id === secondId), false);
    return { pass: true, actual: "HTTP 200; CANCELLED; removed from pending queue" };
  });

  await verify("QUEUE-005", "queue", "Cancelled command cannot execute", "HTTP 4xx; queue and spacecraft remain unchanged", async () => {
    const stateBefore = await readSpacecraft();
    const queueBefore = await readQueue();
    const response = await request("POST", `/commands/queue/${encodeURIComponent(secondId)}/execute`, { json: {} });
    assert.ok(response.status >= 400 && response.status < 500);
    assertJson(response);
    assert.ok(sameJson(stateBefore, await readSpacecraft()));
    assert.ok(sameJson(queueBefore, await readQueue()));
    return { pass: true, actual: `HTTP ${response.status}; no state or pending queue mutation` };
  });

  await verify("QUEUE-006", "queue", "Selected queued command executes and other items wait", "Camera changes; selected record is EXECUTED; no unrelated item runs", async () => {
    const response = await request("POST", `/commands/queue/${encodeURIComponent(firstId)}/execute`, { json: {} });
    const result = assertStatus(response, [200]);
    assertJson(response);
    assert.equal(result.success, true);
    assert.equal(result.state.camera, "ON");
    const record = await request("GET", `/commands/queue/${encodeURIComponent(firstId)}`);
    assert.equal(assertStatus(record, [200]).command.status, "EXECUTED");
    assert.deepEqual((await readQueue()).map((item) => item.id), []);
    return { pass: true, actual: "HTTP 200; camera ON; selected command EXECUTED; no pending command ran" };
  });

  await verify("QUEUE-007", "queue", "Unknown queue IDs are rejected without queue corruption", "GET/DELETE/execute return 404 and queue stays empty", async () => {
    const before = await readQueue();
    const responses = await Promise.all([
      request("GET", "/commands/queue/verify-missing-id"),
      request("DELETE", "/commands/queue/verify-missing-id"),
      request("POST", "/commands/queue/verify-missing-id/execute", { json: {} }),
    ]);
    assert.ok(responses.every((response) => response.status === 404));
    assert.ok(responses.every((response) => response.jsonValid));
    assert.ok(sameJson(before, await readQueue()));
    return { pass: true, actual: "Three unknown-ID operations returned HTTP 404; queue unchanged" };
  });

  await resetDemo();
  await verify("QUEUE-008", "queue", "Failed queued execution is recorded and leaves state unchanged", "CAPTURE_IMAGE becomes FAILED; spacecraft snapshot unchanged", async () => {
    const queued = await request("POST", "/commands/queue", { json: command(COMMAND_TYPES.CAPTURE_IMAGE) });
    const item = assertStatus(queued, [202]).command;
    const before = await readSpacecraft();
    const execution = await request("POST", `/commands/queue/${encodeURIComponent(item.id)}/execute`, { json: {} });
    assert.equal(execution.status, 409);
    assert.equal(execution.json.command.status, "FAILED");
    assert.ok(sameJson(before, await readSpacecraft()));
    return { pass: true, actual: "HTTP 409; FAILED; spacecraft unchanged" };
  });

  await verify("QUEUE-009", "queue", "Malformed/unknown command is not admitted", "HTTP 4xx; queue stays empty", async () => {
    const response = await request("POST", "/commands/queue", { json: { type: "VERIFY_INVALID" } });
    assert.ok(response.status >= 400 && response.status < 500);
    assertJson(response);
    assert.deepEqual(await readQueue(), []);
    return { pass: true, actual: `HTTP ${response.status}; pending queue empty` };
  });
}

async function verifySimulationAndPlanner() {
  await resetDemo();
  await verify("SIM-001", "simulation", "Empty queued simulation returns a safe modeled result", "GET simulation is safe and does not mutate state/queue", async () => {
    const stateBefore = await readSpacecraft();
    const queueBefore = await readQueue();
    const response = await request("GET", "/commands/queue/simulation");
    const result = assertStatus(response, [200]);
    assertJson(response);
    assert.equal(result.safe, true);
    assert.ok(sameJson(stateBefore, await readSpacecraft()));
    assert.ok(sameJson(queueBefore, await readQueue()));
    return { pass: true, actual: "HTTP 200; safe=true; state and queue unchanged" };
  });

  await verify("PLAN-001", "planner", "Empty queue is safe as-is", "GET plan returns SAFE_AS_IS", async () => {
    const response = await request("GET", "/commands/queue/plan");
    const result = assertStatus(response, [200]);
    assertJson(response);
    assert.equal(result.status, "SAFE_AS_IS");
    return { pass: true, actual: `HTTP ${response.status}; ${result.status}` };
  });

  await resetDemo();
  const capture = await request("POST", "/commands/queue", { json: command(COMMAND_TYPES.CAPTURE_IMAGE) });
  const captureId = assertStatus(capture, [202]).command.id;
  await verify("SIM-002", "simulation", "Unsafe precondition is explicit and simulation does not execute", "GET reports failure; spacecraft/queue unchanged", async () => {
    const stateBefore = await readSpacecraft();
    const queueBefore = await readQueue();
    const response = await request("GET", "/commands/queue/simulation");
    const result = assertStatus(response, [200]);
    assertJson(response);
    assert.equal(result.safe, false);
    assert.equal(result.executionFailure?.error?.code, "INVALID_STATE");
    assert.ok(sameJson(stateBefore, await readSpacecraft()));
    assert.ok(sameJson(queueBefore, await readQueue()));
    return { pass: true, actual: "HTTP 200; unsafe precondition reported; no mutation" };
  });

  await verify("SIM-003", "simulation", "Proposed-command simulation remains temporary", "POST simulates appended command without enqueue or execution", async () => {
    const stateBefore = await readSpacecraft();
    const queueBefore = await readQueue();
    const response = await request("POST", "/commands/queue/simulation", { json: command(COMMAND_TYPES.CAMERA_ON) });
    const result = assertStatus(response, [200]);
    assertJson(response);
    assert.equal(result.safe, false);
    assert.equal(result.steps.at(-1)?.command?.type, COMMAND_TYPES.CAPTURE_IMAGE);
    assert.ok(sameJson(stateBefore, await readSpacecraft()));
    assert.ok(sameJson(queueBefore, await readQueue()));
    return { pass: true, actual: "HTTP 200; proposal not queued; real state and queue unchanged" };
  });

  await verify("SIM-004", "simulation", "Valid proposed command can be simulated", "POST returns ordered step without queue mutation", async () => {
    await resetDemo();
    const beforeState = await readSpacecraft();
    const beforeQueue = await readQueue();
    const response = await request("POST", "/commands/queue/simulation", { json: command(COMMAND_TYPES.CAMERA_ON) });
    const result = assertStatus(response, [200]);
    assertJson(response);
    assert.equal(result.steps[0].success, true);
    assert.equal(result.finalState.camera, "ON");
    assert.ok(sameJson(beforeState, await readSpacecraft()));
    assert.ok(sameJson(beforeQueue, await readQueue()));
    return { pass: true, actual: "HTTP 200; predicted camera ON; actual state/queue unchanged" };
  });

  await verify("SIM-005", "simulation", "Transmission uses communication-available modeled path", "HIGH_POWER_TRANSMISSION simulates successfully from deployed-antenna baseline", async () => {
    const response = await request("POST", "/commands/queue/simulation", { json: command(COMMAND_TYPES.HIGH_POWER_TRANSMISSION) });
    const result = assertStatus(response, [200]);
    assertJson(response);
    assert.equal(result.steps[0].success, true);
    assert.equal(result.finalState.battery, 80);
    return { pass: true, actual: "HTTP 200; radio/antenna precondition passed; modeled battery effect returned" };
  });

  skip("SIM-006", "simulation", "Unavailable-radio constraint rejection", "The public HTTP API exposes no way to set radio OFF or antenna STOWED; verifier does not mutate private service state");

  await resetDemo();
  await verify("PLAN-002", "planner", "Dependency-aware safe reorder is found", "POST plan finds CAMERA_ON before queued CAPTURE_IMAGE without mutating queue/state", async () => {
    const pending = await request("POST", "/commands/queue", { json: command(COMMAND_TYPES.CAPTURE_IMAGE) });
    assertStatus(pending, [202]);
    const beforeState = await readSpacecraft();
    const beforeQueue = await readQueue();
    const response = await request("POST", "/commands/queue/plan", { json: command(COMMAND_TYPES.CAMERA_ON) });
    const result = assertStatus(response, [200]);
    assertJson(response);
    assert.equal(result.status, "SAFE_REORDER_FOUND");
    assert.deepEqual(result.plannedOrder.map((item) => item.type), [COMMAND_TYPES.CAMERA_ON, COMMAND_TYPES.CAPTURE_IMAGE]);
    assert.ok(sameJson(beforeState, await readSpacecraft()));
    assert.ok(sameJson(beforeQueue, await readQueue()));
    return { pass: true, actual: "HTTP 200; SAFE_REORDER_FOUND; state/queue unchanged" };
  });

  await verify("PLAN-003", "planner", "Dependency-valid sequence with failed precondition yields NO_SAFE_PLAN", "GET plan reports NO_SAFE_PLAN", async () => {
    await resetDemo();
    await request("POST", "/commands/queue", { json: command(COMMAND_TYPES.CAPTURE_IMAGE) });
    await request("POST", "/commands/queue", { json: command(COMMAND_TYPES.CAMERA_OFF) });
    const response = await request("GET", "/commands/queue/plan");
    const result = assertStatus(response, [200]);
    assertJson(response);
    assert.equal(result.status, "NO_SAFE_PLAN");
    return { pass: true, actual: `HTTP ${response.status}; ${result.status}` };
  });

  await verify("PLAN-004", "planner", "Queue over configured planning cap is reported explicitly", "GET plan reports PLANNING_LIMIT_EXCEEDED", async () => {
    await resetDemo();
    for (let index = 0; index < 6; index += 1) {
      const response = await request("POST", "/commands/queue", { json: command(COMMAND_TYPES.PING) });
      assert.equal(response.status, 202);
    }
    const response = await request("GET", "/commands/queue/plan");
    const result = assertStatus(response, [200]);
    assertJson(response);
    assert.equal(result.status, "PLANNING_LIMIT_EXCEEDED");
    return { pass: true, actual: `HTTP ${response.status}; ${result.status}` };
  });
}

async function verifySecurityGateway() {
  await resetDemo();
  const stateBefore = await readSpacecraft();
  await verify("SECURITY-001", "gateway", "Valid operator/HMAC request is admitted once and not executed", "HTTP 202; checks pass; one queued item; spacecraft unchanged", async () => {
    const envelope = createEnvelope("operator-1", COMMAND_TYPES.CAMERA_ON);
    const response = await request("POST", "/gateway/commands", { json: envelope });
    const result = assertStatus(response, [202]);
    assertJson(response);
    assert.equal(result.decision, "ACCEPTED");
    for (const stage of ["authentication", "authorization", "integrity", "replay"]) {
      assert.equal(result.checks[stage].passed, true);
    }
    assert.equal((await readQueue()).filter((item) => item.id === envelope.command.id).length, 1);
    assert.ok(sameJson(stateBefore, await readSpacecraft()));
    return { pass: true, actual: "HTTP 202; all gateway checks passed; queued once; not executed" };
  });

  await verify("SECURITY-002", "gateway", "Invalid credential is rejected without queue/state mutation", "HTTP 401 and no admission or execution", async () => {
    await resetDemo();
    const envelope = createEnvelope("operator-1", COMMAND_TYPES.CAMERA_ON, {}, { credential: "not-valid" });
    const before = await readSpacecraft();
    const response = await request("POST", "/gateway/commands", { json: envelope });
    const result = assertStatus(response, [401]);
    assertJson(response);
    assert.equal(result.checks.authentication.passed, false);
    assert.deepEqual(await readQueue(), []);
    assert.ok(sameJson(before, await readSpacecraft()));
    return { pass: true, actual: "HTTP 401; rejected; queue empty; state unchanged" };
  });

  await verify("SECURITY-003", "gateway", "Unknown operator is rejected", "HTTP 401 with no queue admission", async () => {
    const response = await request("POST", "/gateway/commands", {
      json: {
        operatorId: "verify-unknown-operator",
        credential: "invalid",
        command: signedCommand("operator-1", COMMAND_TYPES.PING),
        signature: "0".repeat(64),
      },
    });
    assert.equal(response.status, 401);
    assertJson(response);
    assert.deepEqual(await readQueue(), []);
    return { pass: true, actual: "HTTP 401; queue empty" };
  });

  await verify("SECURITY-004", "gateway", "Unauthorized command is rejected", "OPERATOR cannot submit HIGH_POWER_TRANSMISSION", async () => {
    const response = await request("POST", "/gateway/commands", { json: createEnvelope("operator-1", COMMAND_TYPES.HIGH_POWER_TRANSMISSION) });
    const result = assertStatus(response, [403]);
    assertJson(response);
    assert.equal(result.checks.authorization.passed, false);
    assert.deepEqual(await readQueue(), []);
    return { pass: true, actual: "HTTP 403; authorization failed; queue empty" };
  });

  await verify("SECURITY-005", "gateway", "Invalid HMAC is rejected", "HTTP 401; no queue admission", async () => {
    const response = await request("POST", "/gateway/commands", { json: createEnvelope("operator-1", COMMAND_TYPES.PING, {}, { signature: "0".repeat(64) }) });
    const result = assertStatus(response, [401]);
    assertJson(response);
    assert.equal(result.checks.integrity.passed, false);
    assert.deepEqual(await readQueue(), []);
    return { pass: true, actual: "HTTP 401; integrity failed; queue empty" };
  });

  await verify("SECURITY-006", "gateway", "Post-signing command modification is detected", "HTTP 401 and integrity result fails", async () => {
    const envelope = createEnvelope("operator-1", COMMAND_TYPES.CAMERA_ON);
    envelope.command.type = COMMAND_TYPES.CAMERA_OFF;
    const response = await request("POST", "/gateway/commands", { json: envelope });
    const result = assertStatus(response, [401]);
    assertJson(response);
    assert.equal(result.checks.integrity.integrityValid, false);
    assert.deepEqual(await readQueue(), []);
    return { pass: true, actual: "HTTP 401; modified payload rejected; queue empty" };
  });

  await verify("SECURITY-007", "gateway", "Expired timestamp is rejected", "HTTP 409; timestampValid false", async () => {
    const oldTimestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const response = await request("POST", "/gateway/commands", {
      json: createEnvelope("operator-1", COMMAND_TYPES.PING, {}, { timestamp: oldTimestamp }),
    });
    const result = assertStatus(response, [409]);
    assertJson(response);
    assert.equal(result.checks.replay.timestampValid, false);
    assert.deepEqual(await readQueue(), []);
    return { pass: true, actual: "HTTP 409; timestamp rejected; queue empty" };
  });

  await verify("SECURITY-008", "gateway", "Exact command replay is rejected and not enqueued twice", "First accepted; second HTTP 409; queue contains one copy", async () => {
    await resetDemo();
    const envelope = createEnvelope("operator-1", COMMAND_TYPES.PING);
    const first = await request("POST", "/gateway/commands", { json: envelope });
    assert.equal(first.status, 202);
    const second = await request("POST", "/gateway/commands", { json: envelope });
    const result = assertStatus(second, [409]);
    assertJson(second);
    assert.equal(result.checks.replay.replayDetected, true);
    assert.equal((await readQueue()).filter((item) => item.id === envelope.command.id).length, 1);
    return { pass: true, actual: "First HTTP 202; replay HTTP 409; exactly one queued copy" };
  });

  await verify("SECURITY-009", "gateway", "Nonce reuse by the same operator is rejected", "Second distinct command ID with reused nonce is HTTP 409", async () => {
    await resetDemo();
    const nonce = "verify-m10-reused-nonce";
    const first = createEnvelope("operator-1", COMMAND_TYPES.PING, {}, { nonce });
    const second = createEnvelope("operator-1", COMMAND_TYPES.PING, {}, { nonce });
    assert.equal((await request("POST", "/gateway/commands", { json: first })).status, 202);
    const response = await request("POST", "/gateway/commands", { json: second });
    const result = assertStatus(response, [409]);
    assertJson(response);
    assert.equal(result.checks.replay.replayDetected, true);
    assert.equal((await readQueue()).length, 1);
    return { pass: true, actual: "Nonce replay rejected; only first command queued" };
  });

  await verify("SECURITY-010", "gateway", "Malformed envelope is rejected", "HTTP 4xx with structured JSON", async () => {
    await resetDemo();
    const response = await request("POST", "/gateway/commands", { json: { operatorId: "operator-1" } });
    assert.ok(response.status >= 400 && response.status < 500);
    assertJson(response);
    assert.equal(response.json.decision, "REJECTED");
    assert.deepEqual(await readQueue(), []);
    return { pass: true, actual: `HTTP ${response.status}; structured rejection; queue empty` };
  });

  await verify("SECURITY-011", "gateway", "Accepted gateway command remains queued, not executed", "Camera stays OFF; command remains QUEUED", async () => {
    await resetDemo();
    const envelope = createEnvelope("operator-1", COMMAND_TYPES.CAMERA_ON);
    const response = await request("POST", "/gateway/commands", { json: envelope });
    assert.equal(response.status, 202);
    assert.equal((await readSpacecraft()).camera, "OFF");
    assert.equal((await readQueue()).find((item) => item.id === envelope.command.id)?.status, "QUEUED");
    return { pass: true, actual: "Command queued; spacecraft camera remains OFF" };
  });

  await verify("SECURITY-012", "decision", "Decision endpoint returns structured ALLOW and records an event", "HTTP 200; security checks pass; command queued but not executed", async () => {
    await resetDemo();
    const before = await readSpacecraft();
    const envelope = createEnvelope("operator-1", COMMAND_TYPES.PING);
    const response = await request("POST", "/gateway/commands/evaluate", { json: envelope });
    const result = assertStatus(response, [200]);
    assertJson(response);
    assert.equal(result.decision, "ALLOW");
    for (const stage of ["authentication", "authorization", "integrity", "replay"]) {
      assert.equal(result.security.checks[stage].passed, true);
    }
    assert.ok(sameJson(before, await readSpacecraft()));
    assert.equal((await readQueue()).filter((item) => item.id === envelope.command.id).length, 1);
    assert.ok(result.event?.id);
    return { pass: true, actual: "HTTP 200; ALLOW; event returned; queued once; not executed" };
  });
}

async function verifyScenariosAndDecisionLevels() {
  const scenariosResponse = await verify("SCENARIO-001", "scenarios", "Scenario catalog exposes all current deterministic scenarios", "HTTP 200 array with eight metadata records", async () => {
    const response = await request("GET", "/scenarios");
    const scenarios = assertStatus(response, [200]);
    assertJson(response);
    assert.ok(Array.isArray(scenarios));
    assert.equal(scenarios.length, 8);
    for (const scenario of scenarios) {
      for (const field of ["id", "name", "title", "description", "category", "expectedBehavior"]) {
        assert.ok(scenario[field], `Scenario missing ${field}`);
      }
    }
    return { pass: true, actual: `HTTP ${response.status}; ${scenarios.length} scenario records with metadata`, value: scenarios };
  });

  const scenarioContracts = new Map([
    ["normal_safe_command", (run) => run.result?.decision === "ALLOW"],
    ["tampered_command", (run) => run.result?.decision === "QUARANTINE" && run.result.security?.checks?.integrity?.passed === false],
    ["replayed_command", (run) => run.result?.firstSubmission?.decision === "ALLOW" && run.result?.replaySubmission?.security?.checks?.replay?.replayDetected === true],
    ["legitimate_but_unsafe", (run) => run.result?.decision === "HOLD" && run.result?.planner?.status === "SAFE_REORDER_FOUND" && allSecurityPassed(run.result)],
    ["no_safe_plan", (run) => run.result?.decision === "QUARANTINE" && run.result?.planner?.status === "NO_SAFE_PLAN" && run.result?.signals?.some((signal) => signal.type === "NO_SAFE_PLAN")],
    ["command_burst", (run) => run.result?.submissions?.at(-1)?.decision === "WATCH" && run.result.submissions.at(-1).signals.some((signal) => signal.type === "SUSPICIOUS_COMMAND_BURST")],
    ["escalation_to_restricted", (run) => run.result?.restrictedPing?.decision === "RESTRICTED" && run.result?.permittedSafetyCommand?.decision === "ALLOW"],
    ["critical_escalation_to_safe_mode", (run) => run.result?.replaySubmission?.decision === "SAFE_MODE" && run.spacecraft?.mode === "SAFE" && run.events?.some((event) => event.decision === "SAFE_MODE")],
  ]);

  if (Array.isArray(scenariosResponse)) {
    for (const scenario of scenariosResponse) {
      const contract = scenarioContracts.get(scenario.id);
      await verify(`SCENARIO-${scenario.name}`, "scenarios", `${scenario.name} produces its actual intended behavior`, scenario.expectedBehavior, async () => {
        assert.ok(contract, "Scenario has no verification contract");
        const response = await request("POST", `/scenarios/${encodeURIComponent(scenario.id)}/run`, { json: {} });
        const run = assertStatus(response, [200]);
        assertJson(response);
        assert.equal(run.scenario?.id, scenario.id);
        assert.ok(contract(run), "Actual decision/result did not match the scenario contract");
        return { pass: true, actual: summarizeScenario(run) };
      });
    }
  }

  await verify("SCENARIO-010", "scenarios", "Unknown scenario ID returns a structured 404", "HTTP 404 JSON error", async () => {
    const response = await request("POST", "/scenarios/verify-unknown-scenario/run", { json: {} });
    assert.equal(response.status, 404);
    const data = assertJson(response);
    assert.ok(data.error?.code);
    return { pass: true, actual: "HTTP 404; structured error" };
  });

  await verify("DECISION-001", "decision", "HOLD retains a command without executing it", "Held record appears; execute rejected; state unchanged", async () => {
    await resetDemo();
    await request("POST", "/spacecraft/commands", { json: command(COMMAND_TYPES.CAMERA_ON) });
    const capture = await request("POST", "/gateway/commands/evaluate", { json: createEnvelope("operator-1", COMMAND_TYPES.CAPTURE_IMAGE) });
    assert.equal(capture.json.decision, "ALLOW");
    await request("POST", "/spacecraft/commands", { json: command(COMMAND_TYPES.CAMERA_OFF) });
    const before = await readSpacecraft();
    const decision = await request("POST", "/gateway/commands/evaluate", { json: createEnvelope("operator-1", COMMAND_TYPES.CAMERA_ON) });
    assert.equal(decision.json.decision, "HOLD");
    assert.equal(decision.json.planner.status, "SAFE_REORDER_FOUND");
    const held = await request("GET", "/commands/held");
    assert.equal(assertJson(held).commands.length, 1);
    const heldId = assertJson(held).commands[0].id;
    const execute = await request("POST", `/commands/queue/${encodeURIComponent(heldId)}/execute`, { json: {} });
    assert.ok(execute.status >= 400 && execute.status < 500);
    assert.ok(sameJson(before, await readSpacecraft()));
    return { pass: true, actual: "HOLD recorded; no approval path; held execute rejected; state unchanged" };
  });

  await verify("DECISION-002", "decision", "Quarantined command does not enter executable queue", "NO_SAFE_PLAN quarantines proposed command; state unchanged", async () => {
    await resetDemo();
    await request("POST", "/commands/queue", { json: command(COMMAND_TYPES.CAPTURE_IMAGE) });
    const before = await readSpacecraft();
    const result = await request("POST", "/gateway/commands/evaluate", { json: createEnvelope("operator-1", COMMAND_TYPES.CAMERA_OFF) });
    assert.equal(result.json.decision, "QUARANTINE");
    assert.equal(result.json.planner.status, "NO_SAFE_PLAN");
    assert.equal((await readQueue()).some((item) => item.id === result.json.command.id), false);
    assert.ok((await request("GET", "/security/quarantine")).json.commands.length > 0);
    assert.ok(sameJson(before, await readSpacecraft()));
    return { pass: true, actual: "QUARANTINE record exists; proposed command not pending; state unchanged" };
  });

  await verify("EVENT-001", "security", "Events are newest-first, structured, and secret-free", "GET events returns event records without credentials or keys", async () => {
    const response = await request("GET", "/security/events");
    const data = assertStatus(response, [200]);
    assertJson(response);
    assert.ok(Array.isArray(data.events));
    if (data.events.length > 1) {
      assert.ok(Date.parse(data.events[0].timestamp) >= Date.parse(data.events[1].timestamp));
    }
    for (const event of data.events) {
      for (const field of ["id", "timestamp", "type", "severity", "decision", "message", "signals"]) {
        assert.ok(Object.hasOwn(event, field), `Event missing ${field}`);
      }
    }
    assert.equal(responseContainsSecret(response.raw), false);
    return { pass: true, actual: `HTTP ${response.status}; ${data.events.length} newest-first events; secret scan clear` };
  });

  await verify("QUARANTINE-001", "security", "Quarantine API returns structured, secret-free records", "HTTP 200 array; no credential/signature/key leakage", async () => {
    const response = await request("GET", "/security/quarantine");
    const data = assertStatus(response, [200]);
    assertJson(response);
    assert.ok(Array.isArray(data.commands));
    assert.equal(responseContainsSecret(response.raw), false);
    return { pass: true, actual: `HTTP ${response.status}; ${data.commands.length} records; secret scan clear` };
  });

  await verify("SECURITY-REDACTION-001", "security", "No observed API response exposes configured prototype secrets", "Response scan finds no known secret values or credential/signature fields", async () => {
    assert.equal(secretLeakFound, false);
    assert.equal(sensitiveFieldLeakFound, false);
    return { pass: true, actual: "No configured secret values or credential/signature fields found in observed responses" };
  });
}

async function verifyResetAndRepeatability() {
  await verify("RESET-001", "scenarios", "Scenario reset restores state and clears queue/security stores", "Nominal state; pending/held/events/quarantine empty", async () => {
    const response = await request("POST", "/scenarios/reset", { json: {} });
    const reset = assertStatus(response, [200]);
    assertJson(response);
    assert.equal(reset.reset, true);
    assert.equal(reset.spacecraft.mode, "NOMINAL");
    assert.deepEqual(reset.queue.pending, []);
    assert.deepEqual(reset.queue.held, []);
    assert.deepEqual(reset.events, []);
    assert.deepEqual(reset.quarantine, []);
    const state = await readSpacecraft();
    assert.equal(state.mode, "NOMINAL");
    assert.deepEqual(await readQueue(), []);
    assert.deepEqual((await request("GET", "/commands/held")).json.commands, []);
    assert.deepEqual((await request("GET", "/security/events")).json.events, []);
    assert.deepEqual((await request("GET", "/security/quarantine")).json.commands, []);
    return { pass: true, actual: "HTTP 200; baseline state and all demo stores cleared" };
  });

  await verify("RESET-002", "scenarios", "Hero scenario repeats with the same logical result after reset", "HOLD and safe planner order match across two reset-separated runs", async () => {
    await resetDemo();
    const firstResponse = await request("POST", "/scenarios/legitimate_but_unsafe/run", { json: {} });
    const first = assertStatus(firstResponse, [200]);
    await resetDemo();
    const secondResponse = await request("POST", "/scenarios/legitimate_but_unsafe/run", { json: {} });
    const second = assertStatus(secondResponse, [200]);
    const firstOrder = first.result.planner.plannedOrder.map((item) => item.type);
    const secondOrder = second.result.planner.plannedOrder.map((item) => item.type);
    assert.equal(first.result.decision, "HOLD");
    assert.equal(second.result.decision, first.result.decision);
    assert.deepEqual(secondOrder, firstOrder);
    return { pass: true, actual: `Both runs HOLD; planner order ${firstOrder.join(" -> ")}` };
  });

  await verify("RESET-003", "workflow", "Reset followed by normal scenario returns ALLOW", "Clean baseline then real NORMAL_SAFE_COMMAND result is ALLOW", async () => {
    await resetDemo();
    const response = await request("POST", "/scenarios/normal_safe_command/run", { json: {} });
    const result = assertStatus(response, [200]);
    assert.equal(result.result.decision, "ALLOW");
    assert.equal((await readSpacecraft()).mode, "NOMINAL");
    return { pass: true, actual: "Reset baseline followed by actual ALLOW scenario" };
  });
}

async function verifyEndpointManifest() {
  await verify("ROUTES-001", "routes", "All registered Express endpoints have HTTP coverage", `${ENDPOINT_MANIFEST.length} manifest entries covered`, async () => {
    const missing = ENDPOINT_MANIFEST
      .map(([method, route]) => `${method} ${route}`)
      .filter((entry) => !coveredEndpoints.has(entry));
    assert.deepEqual(missing, [], `Uncovered endpoint manifest entries: ${missing.join(", ")}`);
    return { pass: true, actual: `${coveredEndpoints.size}/${ENDPOINT_MANIFEST.length} route methods exercised` };
  });
}

function allSecurityPassed(result) {
  return ["authentication", "authorization", "integrity", "replay"]
    .every((stage) => result.security?.checks?.[stage]?.passed === true);
}

function summarizeScenario(run) {
  const result = run.result;
  if (result?.decision) return `decision=${result.decision}; level=${result.level ?? "n/a"}`;
  if (result?.replaySubmission) return `first=${result.firstSubmission?.decision}; replay=${result.replaySubmission.decision}`;
  if (result?.submissions) return `submissions=${result.submissions.length}; final=${result.submissions.at(-1)?.decision}`;
  if (result?.restrictedPing) return `ping=${result.restrictedPing.decision}; allowed action=${result.permittedSafetyCommand?.decision}`;
  return "Scenario response received";
}

function responseContainsSecret(serialized) {
  return knownSecrets.some((secret) => secret && serialized.includes(secret));
}

function containsSensitiveField(value) {
  if (Array.isArray(value)) return value.some(containsSensitiveField);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, nested]) =>
    /credential|authtoken|hmacsecret|signature/i.test(key) || containsSensitiveField(nested),
  );
}

function makeEnvelope(operatorId, type, parameters = {}, overrides = {}) {
  const operator = PROTOTYPE_OPERATORS[operatorId];
  const commandPayload = signedCommand(operatorId, type, parameters, overrides);
  return {
    operatorId,
    credential: overrides.credential ?? operator.authToken,
    command: commandPayload,
    signature: overrides.signature ?? calculateCommandSignature(commandPayload, operatorId, operator.hmacSecret),
  };
}

function signedCommand(operatorId, type, parameters = {}, overrides = {}) {
  const id = overrides.id ?? nextId("gateway");
  return {
    id,
    type,
    parameters,
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    nonce: overrides.nonce ?? `${id}-nonce`,
  };
}

function nextId(prefix) {
  commandOrdinal += 1;
  return `verify-m10-${prefix}-${String(commandOrdinal).padStart(3, "0")}`;
}

async function allocatePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return port;
}

function appendOutput(stream, label) {
  let remainder = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    const lines = `${remainder}${chunk}`.split(/\r?\n/);
    remainder = lines.pop() ?? "";
    serverOutput.push(...lines.map((line) => `${label}: ${line}`));
    if (serverOutput.length > CHILD_LOG_LIMIT * 2) {
      serverOutput = serverOutput.slice(-CHILD_LOG_LIMIT);
    }
  });
}

async function waitForBackend(port) {
  const started = Date.now();
  while (Date.now() - started < STARTUP_TIMEOUT_MS) {
    if (backendProcess.exitCode !== null) return false;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(700),
      });
      if (response.status === 200) return true;
    } catch {
      // Bounded startup polling keeps the verifier independent of arbitrary sleeps.
    }
    await sleep(100);
  }
  return false;
}

async function stopBackend() {
  if (!backendProcess || backendProcess.exitCode !== null) return;
  shutdownRequested = true;
  backendProcess.kill();
  const stopped = await Promise.race([
    once(backendProcess, "exit").then(() => true),
    sleep(3000).then(() => false),
  ]);
  if (!stopped && backendProcess.exitCode === null) {
    backendProcess.kill("SIGKILL");
    await Promise.race([once(backendProcess, "exit"), sleep(1500)]);
  }
}

async function runFrontendBuild() {
  const started = Date.now();
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npm, ["run", "build"], {
    cwd: path.join(ROOT, "frontend"),
    encoding: "utf8",
    timeout: 120000,
    shell: process.platform === "win32",
    env: process.env,
  });
  const output = redact(`${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  const passed = result.status === 0;
  recordCheck({
    id: "FRONTEND-BUILD-001",
    subsystem: "frontend",
    description: "React/Vite production build succeeds",
    expected: "npm run build exits 0",
    actual: passed ? "Production build completed" : `Build failed: ${output.split(/\r?\n/).filter(Boolean).slice(-12).join(" | ")}`,
    status: passed ? "PASS" : "FAIL",
    durationMs: Date.now() - started,
    critical: true,
  });
}

function summary() {
  const counts = { pass: 0, fail: 0, warn: 0, skip: 0 };
  for (const check of checks) counts[check.status.toLowerCase()] += 1;
  return {
    ...counts,
    criticalFailures: checks.filter((check) => check.status === "FAIL" && check.critical).length,
  };
}

function printReport(report) {
  console.log("==================================================");
  console.log("SAT Guard Full-System Verification");
  console.log("==================================================");
  for (const check of report.checks) {
    console.log(`\n[${check.status}] ${check.id}\n${check.description}`);
    if (check.status !== "PASS") {
      console.log(`Expected: ${check.expected}\nActual: ${check.actual}`);
    }
  }
  console.log("\n==================================================\nSUMMARY\n==================================================");
  console.log(`PASS: ${report.summary.pass}`);
  console.log(`FAIL: ${report.summary.fail}`);
  console.log(`WARN: ${report.summary.warn}`);
  console.log(`SKIP: ${report.summary.skip}`);
  console.log(`Critical failures: ${report.summary.criticalFailures}`);
  console.log(`\nVerification ${report.overallStatus}`);
  console.log(`JSON report: ${path.relative(ROOT, REPORT_PATH)}`);
}

async function main() {
  const started = Date.now();
  console.log("Starting isolated SAT Guard verification backend...");
  let backendReady = false;

  try {
    const port = await allocatePort();
    baseUrl = `http://127.0.0.1:${port}`;
    backendProcess = spawn(process.execPath, [path.join(ROOT, "src", "server.js")], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    backendProcess.once("exit", (code, signal) => {
      if (!shutdownRequested) backendExit = { code, signal };
    });
    appendOutput(backendProcess.stdout, "stdout");
    appendOutput(backendProcess.stderr, "stderr");
    backendReady = await waitForBackend(port);
    recordCheck({
      id: "RUNNER-001",
      subsystem: "runner",
      description: "Isolated Express backend starts on a dedicated port and answers health",
      expected: "Child backend starts and GET /health returns HTTP 200",
      actual: backendReady ? `Child backend ready at ${baseUrl}` : `Backend failed to start. Safe log tail: ${safeTail(serverOutput).join(" | ") || "no output"}`,
      status: backendReady ? "PASS" : "FAIL",
      durationMs: Date.now() - started,
      critical: true,
    });

    if (backendReady) {
      await verifyHealthAndBasicApi();
      await verifySpacecraftAndValidation();
      await verifyQueue();
      await verifySimulationAndPlanner();
      await verifySecurityGateway();
      await verifyScenariosAndDecisionLevels();
      await verifyResetAndRepeatability();
      await verifyEndpointManifest();
      recordCheck({
        id: "RUNNER-002",
        subsystem: "runner",
        description: "Isolated backend remains alive through the full HTTP suite",
        expected: "Backend process stays running until verifier cleanup",
        actual: backendExit
          ? `Unexpected backend exit (code ${backendExit.code ?? "unknown"}, signal ${backendExit.signal ?? "none"}); safe log tail: ${safeTail(serverOutput).join(" | ") || "no output"}`
          : "Backend remained available through all HTTP checks",
        status: backendExit ? "FAIL" : "PASS",
        critical: true,
      });
    } else {
      recordCheck({
        id: "BACKEND-SUITE-001",
        subsystem: "runner",
        description: "HTTP verification suite",
        expected: "Backend available for route verification",
        actual: "Skipped because isolated backend did not become healthy",
        status: "SKIP",
        critical: false,
      });
    }
  } catch (error) {
    recordCheck({
      id: "RUNNER-ERROR-001",
      subsystem: "runner",
      description: "Verification runner completes setup and HTTP checks",
      expected: "Runner continues to report independent checks",
      actual: redact(error?.message ?? "Unexpected verifier error"),
      status: "FAIL",
      critical: true,
    });
  } finally {
    await stopBackend();
    await runFrontendBuild();
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    const totals = summary();
    const report = {
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - started,
      overallStatus: totals.criticalFailures === 0 ? "PASS" : "FAIL",
      summary: totals,
      endpointManifest: ENDPOINT_MANIFEST.map(([method, route, authenticationExpected, stateMutationExpected]) => ({
        method,
        path: route,
        authenticationExpected,
        stateMutationExpected,
        exercised: coveredEndpoints.has(`${method} ${route}`),
      })),
      checks,
      diagnostics: backendExit || !backendReady ? safeTail(serverOutput) : [],
    };
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    printReport(report);
    process.exitCode = totals.criticalFailures === 0 ? 0 : 1;
  }
}

main().catch((error) => {
  console.error(redact(error?.message ?? "Fatal verifier error"));
  process.exitCode = 1;
});