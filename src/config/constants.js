const PORT = Number(process.env.PORT) || 3000;
// Illustrative hackathon policy thresholds, not spacecraft specifications.
const MIN_BATTERY = 25;
const MIN_FUEL = 20;
const MIN_TEMPERATURE = 0;
const MAX_TEMPERATURE = 50;
const COMMAND_TIMESTAMP_WINDOW_MS = 5 * 60 * 1000;
const SUSPICIOUS_BURST_THRESHOLD = 5;
const SUSPICIOUS_BURST_WINDOW_MS = 60 * 1000;
const SERIOUS_EVENT_WINDOW_MS = 10 * 60 * 1000;
const SERIOUS_EVENTS_FOR_RESTRICTED = 3;
const SERIOUS_EVENTS_FOR_SAFE_MODE = 2;

// Local hackathon prototype credentials only; never use these as production secrets.
const PROTOTYPE_OPERATORS = Object.freeze({
	"operator-1": Object.freeze({
		id: "operator-1",
		role: "OPERATOR",
		authToken: "orbitguard-prototype-operator-1-token",
		hmacSecret: "orbitguard-prototype-operator-1-hmac-key",
	}),
	"operator-2": Object.freeze({
		id: "operator-2",
		role: "OPERATOR",
		authToken: "orbitguard-prototype-operator-2-token",
		hmacSecret: "orbitguard-prototype-operator-2-hmac-key",
	}),
	"mission-engineer": Object.freeze({
		id: "mission-engineer",
		role: "MISSION_ENGINEER",
		authToken: "orbitguard-prototype-mission-engineer-token",
		hmacSecret: "orbitguard-prototype-mission-engineer-hmac-key",
	}),
	admin: Object.freeze({
		id: "admin",
		role: "ADMIN",
		authToken: "orbitguard-prototype-admin-token",
		hmacSecret: "orbitguard-prototype-admin-hmac-key",
	}),
});

module.exports = {
	PORT,
	MIN_BATTERY,
	MIN_FUEL,
	MIN_TEMPERATURE,
	MAX_TEMPERATURE,
	COMMAND_TIMESTAMP_WINDOW_MS,
	SUSPICIOUS_BURST_THRESHOLD,
	SUSPICIOUS_BURST_WINDOW_MS,
	SERIOUS_EVENT_WINDOW_MS,
	SERIOUS_EVENTS_FOR_RESTRICTED,
	SERIOUS_EVENTS_FOR_SAFE_MODE,
	PROTOTYPE_OPERATORS,
};