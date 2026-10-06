# SAT Guard

SAT Guard is a deterministic Node.js/Express prototype of a cybersecurity gateway and modeled command-safety workflow for a simulated spacecraft. Its values and constraints are for hackathon demonstration only.

## Ground Station → Signed Packet → SATGUARD

The architecture is intentionally layered so the command creation flow remains separate from the attack-lab flow and the real security decision path.

Ground Station / Workstation
  ↓
Command Packet Creation + Signing
  ↓
Optional Attack Interceptor (controlled testing only)
  ↓
SATGUARD Security Gateway
  ↓
Authentication + Authorization + Validation + HMAC Integrity + Replay Protection
  ↓
Sequence Analysis + Consequence Simulation + Execution Planning
  ↓
Security Policy / Decision Engine
  ↓
ALLOW / WATCH / HOLD / QUARANTINE / RESTRICTED / SAFE_MODE
  ↓
Spacecraft Simulator

The attack interceptor is not a generic intrusion tool. It is a bounded laboratory component that modifies already-signed packets in a deterministic way so the gateway can detect tampering, replay, reordering, duplication, and burst behavior without bypassing the real SATGUARD logic.

## Command Session and Packet Model

SAT Guard now includes a lightweight in-memory Command Session abstraction for grouped command streams. A session contains a session ID, operator ID, timestamps, ordered packet references, and metadata used for sequence analysis. It does not replace the command queue; it sits above individual command packets as a transport/analysis layer.

Command packets are signed server-side using the existing canonical HMAC flow. They contain the packet ID, operator ID, command payload, timestamp, nonce, and signature. Secrets are never exposed to the frontend or returned in API responses. Packet inspection is redacted to show the command type, metadata, and truncated signature values only.

## Attack Lab Behavior

The attack-lab endpoints intentionally operate on previously created signed packets or session data.

- tamper: changes the packet payload but keeps the original signature intact
- replay: resubmits the exact same packet
- duplicate: duplicates a packet across a burst pattern
- reorder: reorders signed packets in a session without resigning them
- burst: repeatedly submits the same packet to trigger burst-analysis behavior

These operations are aimed at validating the existing SATGUARD controls, not bypassing them.

## Automated Verification

Run `npm run verify` from the project root. The verifier starts an isolated Express process on a temporary free port, exercises the registered HTTP endpoints, command/security/scenario workflows, state-mutation boundaries, and the frontend production build. It writes a machine-readable report to `verification/results/verification-results.json` and prints a human-readable summary.

`PASS` means the observed HTTP behavior matched the check. `FAIL` means a required contract or invariant did not hold and causes a non-zero exit code. `WARN` is non-critical; `SKIP` identifies behavior that cannot be configured through the public HTTP API. A failure includes a safe expected/actual summary for diagnosis; secrets and signatures are not reported.

Start the backend with `npm start`. For the dashboard, use `npm run dev` from `frontend/`.