const configuredBase = import.meta.env.VITE_API_BASE_URL || "/api";
const API_BASE_URL = configuredBase.replace(/\/$/, "");
const REQUEST_TIMEOUT_MS = 10000;

async function request(path, options = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const backendMessage = data.error?.message ?? data.message;
      const message = response.status === 502
        ? "Backend unavailable"
        : response.status >= 500
        ? "Backend error; see server logs"
        : backendMessage || `Request failed with status ${response.status}`;
      throw new Error(message);
    }

    return data;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Connection timed out");
    }
    if (error instanceof TypeError) {
      throw new Error("Backend unavailable");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function post(path, body = {}) {
  return request(path, { method: "POST", body: JSON.stringify(body) });
}

export const api = {
  getHealth: () => request("/health"),
  getSpacecraftState: () => request("/spacecraft/state").then((data) => data.state),
  getQueue: () => request("/commands/queue").then((data) => data.commands),
  getHeldCommands: () => request("/commands/held").then((data) => data.commands),
  getSecurityEvents: () => request("/security/events").then((data) => data.events),
  getQuarantine: () => request("/security/quarantine").then((data) => data.commands),
  getScenarios: () => request("/scenarios"),
  getQueuePlan: () => request("/commands/queue/plan"),
  resetDemo: () => post("/scenarios/reset"),
  runScenario: (scenarioId) => post(`/scenarios/${encodeURIComponent(scenarioId)}/run`),
  evaluateCommand: (envelope) => post("/gateway/commands/evaluate", envelope),
  getGroundStationSessions: () => request("/ground-station/sessions").then((data) => data.sessions ?? []),
  createGroundStationCommand: (payload) => post("/ground-station/commands", payload).then((data) => data.transmission ? data : data.packet ? { packet: data.packet, transmission: { status: "SIGNED_AND_READY" } } : data),
  createGroundStationSession: (payload) => post("/ground-station/sessions", payload).then((data) => data.session),
  getGroundStationSession: (sessionId) => request(`/ground-station/sessions/${encodeURIComponent(sessionId)}`).then((data) => data.session),
  submitGroundStationSession: (sessionId) => post(`/ground-station/sessions/${encodeURIComponent(sessionId)}/submit`),
  tamperPacket: (payload) => post("/attack-lab/tamper", payload),
  replayPacket: (payload) => post("/attack-lab/replay", payload),
  duplicatePacket: (payload) => post("/attack-lab/duplicate", payload),
  reorderSessionPackets: (payload) => post("/attack-lab/reorder", payload),
  burstPacket: (payload) => post("/attack-lab/burst", payload),
  analyzeSession: (payload) => post("/attack-lab/session/analyze", payload),
};