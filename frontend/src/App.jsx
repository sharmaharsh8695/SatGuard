import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./services/api.js";

const OPERATOR_OPTIONS = ["operator-1", "operator-2", "mission-engineer", "admin"];
const ORIENTATION_OPTIONS = ["NADIR", "ZENITH", "SUN_POINT", "ANTENNA_POINTING"];
const COMMAND_DEFINITIONS = [
  { value: "PING", label: "PING", parameters: [] },
  { value: "CAMERA_ON", label: "CAMERA_ON", parameters: [] },
  { value: "CAMERA_OFF", label: "CAMERA_OFF", parameters: [] },
  { value: "CAPTURE_IMAGE", label: "CAPTURE_IMAGE", parameters: [] },
  { value: "HIGH_POWER_TRANSMISSION", label: "HIGH_POWER_TRANSMISSION", parameters: [] },
  { value: "HEATER_ON", label: "HEATER_ON", parameters: [] },
  { value: "HEATER_OFF", label: "HEATER_OFF", parameters: [] },
  {
    value: "CHANGE_ORIENTATION",
    label: "CHANGE_ORIENTATION",
    parameters: [{ name: "orientation", type: "select", options: ORIENTATION_OPTIONS }],
  },
  { value: "ENTER_SAFE_MODE", label: "ENTER_SAFE_MODE", parameters: [] },
  { value: "RECOVER", label: "RECOVER", parameters: [] },
];

const DEFAULT_OPERATOR = "mission-engineer";

function createSequenceRow() {
  return {
    id: `row-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    type: "",
    parameters: {},
  };
}

function getCommandDefinition(commandType) {
  return COMMAND_DEFINITIONS.find((command) => command.value === commandType) ?? null;
}

function getAttackReportDetails(attack) {
  const wrapper = attack.result ?? {};
  const payload = wrapper.result ?? wrapper;
  const evaluations = Array.isArray(payload.evaluations)
    ? payload.evaluations
    : Array.isArray(payload.results)
      ? payload.results
      : payload.result?.decision
        ? [payload.result]
        : payload.decision
          ? [payload]
          : [];
  const decisions = [...new Set(evaluations.map((entry) => entry.decision).filter(Boolean))];
  const target = wrapper.packetId
    ?? payload.packetId
    ?? payload.originalPacket?.packetId
    ?? payload.packet?.packetId
    ?? wrapper.sessionId
    ?? "Session";
  const explanation = wrapper.explanation
    ?? (wrapper.analysis?.reason ? wrapper.analysis.reason : null)
    ?? (decisions.length ? `Gateway result: ${decisions.join(", ")}` : "Simulation completed; no decision was returned.");
  const labels = {
    analyze: "Session analysis",
    tamper: "Tamper test",
    replay: "Replay test",
    duplicate: "Duplicate test",
    burst: "Burst test",
    reorder: "Reorder test",
  };

  return {
    label: labels[attack.type] ?? attack.type,
    target,
    outcome: explanation,
    decisions: decisions.join(", ") || "Not returned",
    timestamp: attack.timestamp ? new Date(attack.timestamp).toLocaleString() : "Not recorded",
  };
}

function buildCommandPayload(row) {
  const definition = getCommandDefinition(row.type);
  if (!definition || !definition.parameters?.length) {
    return { type: row.type, parameters: {} };
  }

  const normalized = {};
  for (const parameter of definition.parameters) {
    const value = row.parameters?.[parameter.name];
    normalized[parameter.name] = parameter.type === "select" ? (value ?? parameter.options[0]) : (value ?? "");
  }

  return { type: row.type, parameters: normalized };
}

function InteractiveGlobe() {
  const globeRef = useRef(null);

  function handlePointerMove(event) {
    if (!globeRef.current || event.pointerType !== "mouse") return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width - 0.5;
    const y = (event.clientY - bounds.top) / bounds.height - 0.5;
    globeRef.current.style.setProperty("--pointer-x", `${x * 20}deg`);
    globeRef.current.style.setProperty("--pointer-y", `${y * -16}deg`);
  }

  function resetPointer() {
    if (!globeRef.current) return;
    globeRef.current.style.setProperty("--pointer-x", "0deg");
    globeRef.current.style.setProperty("--pointer-y", "0deg");
  }

  return (
    <div className="globe-stage" onPointerMove={handlePointerMove} onPointerLeave={resetPointer}>
      <div className="globe-caption"><span /> LIVE ORBITAL VIEW <span>LEO · 408 KM</span></div>
      <div className="globe-orbit orbit-one" />
      <div className="globe-orbit orbit-two" />
      <div className="globe-core" ref={globeRef} aria-label="Animated orbital globe">
        <div className="globe-sphere">
          <svg className="globe-map" viewBox="0 0 320 320" role="img" aria-hidden="true">
            <defs>
              <clipPath id="globe-clip"><circle cx="160" cy="160" r="148" /></clipPath>
              <radialGradient id="globe-shade" cx="34%" cy="28%" r="78%">
                <stop offset="0%" stopColor="#426c5e" />
                <stop offset="58%" stopColor="#173b3b" />
                <stop offset="100%" stopColor="#091c25" />
              </radialGradient>
              <linearGradient id="globe-land" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#e2b77a" />
                <stop offset="100%" stopColor="#c67d58" />
              </linearGradient>
            </defs>
            <g clipPath="url(#globe-clip)">
              <circle cx="160" cy="160" r="148" fill="url(#globe-shade)" />
              <g className="globe-grid-lines" fill="none">
                <ellipse cx="160" cy="160" rx="146" ry="52" />
                <ellipse cx="160" cy="160" rx="146" ry="100" />
                <ellipse cx="160" cy="160" rx="64" ry="146" />
                <ellipse cx="160" cy="160" rx="112" ry="146" />
                <path d="M12 160h296M30 92h260M30 228h260" />
              </g>
              <g className="globe-land-shapes" fill="url(#globe-land)">
                <path d="m55 74 20-17 20 6 14 17-8 13-18 2-7 17-13 5-12-17-16-6 4-13 16-7zM95 120l20 5 12 18-7 17 12 19-7 22-10 30-15 13-8-22-2-24-13-18 2-24-12-17 5-15zM151 81l15-11 17 8 15-3 12 13-7 11-20 1-7 12-17-3-12-12-15-2zM178 119l21-10 26 8 18 17-6 15-21 2-13 15-20-7-6-17-13-7zM218 193l17-12 20 7 9 17-13 12-23-4zM129 47l19-5 13 10-8 12-18 2-11-8z" />
              </g>
              <circle className="globe-scan" cx="160" cy="160" r="144" />
            </g>
            <circle className="globe-rim" cx="160" cy="160" r="148" />
          </svg>
          <span className="globe-location location-one" />
          <span className="globe-location location-two" />
          <span className="globe-location location-three" />
        </div>
      </div>
      <div className="globe-readout readout-left"><span>ALTITUDE</span><strong>408.2 <small>KM</small></strong></div>
      <div className="globe-readout readout-right"><span>ORBITAL SPEED</span><strong>7.66 <small>KM/S</small></strong></div>
      <div className="globe-footnote">Tracking spacecraft systems <i /> nominal</div>
    </div>
  );
}

function WelcomeScreen({ onEnter }) {
  return (
    <main className="welcome-screen">
      <div className="welcome-stars" aria-hidden="true" />
      <div className="welcome-content">
        <div className="welcome-brand">
          <span className="welcome-brand-mark">OG</span>
          <span>SAT <strong>GUARD</strong></span>
        </div>

        <div className="welcome-visual" aria-hidden="true">
          <div className="welcome-orbit-plane">
            <div className="welcome-orbit-ring" />
            <div className="welcome-satellite-revolution">
              <svg className="welcome-satellite" viewBox="0 0 64 40">
                <path d="M3 5h17v30H3zM44 5h17v30H44z" fill="#547a78" stroke="#b6d2c2" strokeWidth="1.5" />
                <path d="M8 5v30M14 5v30M20 5v30M44 5v30M50 5v30M56 5v30" stroke="#9cbbb0" strokeWidth="1" />
                <path d="M25 14h14v12H25z" fill="#d9bd8b" stroke="#f1dfb9" strokeWidth="1.5" />
                <path d="M32 14V8m0 18v7m-7-13h-5m19 0h5" stroke="#e5d5b5" strokeWidth="1.5" />
                <circle cx="32" cy="20" r="2" fill="#82d6c0" />
              </svg>
            </div>
          </div>
          <InteractiveGlobe />
          <div className="welcome-orbit-caption">LOW EARTH ORBIT <span>·</span> LIVE MONITORING</div>
        </div>

        <section className="welcome-card" aria-labelledby="welcome-title">
          <div className="welcome-eyebrow"><span /> MISSION SECURITY OPERATIONS</div>
          <h1 id="welcome-title">Welcome to <span>SAT Guard</span></h1>
          <p className="welcome-tagline">Detect the next move of an attacker.</p>
          <p className="welcome-description">
            Monitor every command, detect suspicious activity, and protect your spacecraft systems.
          </p>
          <button className="welcome-enter-button" type="button" onClick={onEnter}>
            Enter mission control <span aria-hidden="true">→</span>
          </button>
          <div className="welcome-card-footer"><span /> SECURE GATEWAY <i /> SPACECRAFT PROTECTION</div>
        </section>
      </div>
    </main>
  );
}

function App() {
  const [hasEntered, setHasEntered] = useState(false);
  const [health, setHealth] = useState(null);
  const [spacecraft, setSpacecraft] = useState(null);
  const [queue, setQueue] = useState([]);
  const [held, setHeld] = useState([]);
  const [events, setEvents] = useState([]);
  const [quarantine, setQuarantine] = useState([]);
  const [scenarios, setScenarios] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [selectedPacketId, setSelectedPacketId] = useState("");
  const [sessionDetail, setSessionDetail] = useState(null);
  const [operatorId, setOperatorId] = useState(DEFAULT_OPERATOR);
  const [sequence, setSequence] = useState([createSequenceRow()]);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [attackResult, setAttackResult] = useState(null);
  const [reportSession, setReportSession] = useState(null);
  const [attackHistory, setAttackHistory] = useState([]);
  const [showTechnical, setShowTechnical] = useState(false);
  const [actionError, setActionError] = useState("");
  const [loading, setLoading] = useState({
    health: true,
    spacecraft: true,
    queue: true,
    held: true,
    events: true,
    quarantine: true,
    scenarios: true,
    sessions: true,
    sessionDetail: false,
    action: false,
  });

  const validSequence = useMemo(
    () => sequence.filter((row) => row.type).map((row) => buildCommandPayload(row)),
    [sequence],
  );

  const selectedSessionPackets = useMemo(() => sessionDetail?.packets ?? [], [sessionDetail]);
  const connected = health?.status === "ok";

  async function loadSection(key, load, setValue) {
    setLoading((current) => ({ ...current, [key]: true }));
    try {
      const value = await load();
      setValue(value ?? []);
    } catch (error) {
      if (!actionError) {
        setActionError(error.message);
      }
    } finally {
      setLoading((current) => ({ ...current, [key]: false }));
    }
  }

  async function refreshDashboard() {
    await Promise.all([
      loadSection("health", api.getHealth, setHealth),
      loadSection("spacecraft", api.getSpacecraftState, setSpacecraft),
      loadSection("queue", api.getQueue, setQueue),
      loadSection("held", api.getHeldCommands, setHeld),
      loadSection("events", api.getSecurityEvents, setEvents),
      loadSection("quarantine", api.getQuarantine, setQuarantine),
      loadSection("scenarios", api.getScenarios, setScenarios),
      loadSection("sessions", api.getGroundStationSessions, setSessions),
    ]);
  }

  useEffect(() => {
    if (!hasEntered) return;
    void refreshDashboard();
  }, [hasEntered]);

  useEffect(() => {
    if (!sessions.length) {
      setSelectedSessionId("");
      setSessionDetail(null);
      setSelectedPacketId("");
      return;
    }

    if (!selectedSessionId || !sessions.some((session) => session.sessionId === selectedSessionId)) {
      setSelectedSessionId(sessions[0].sessionId);
    }
  }, [sessions, selectedSessionId]);

  useEffect(() => {
    if (!selectedSessionId) {
      setSessionDetail(null);
      setSelectedPacketId("");
      return;
    }

    let isMounted = true;

    async function fetchSession() {
      setLoading((current) => ({ ...current, sessionDetail: true }));
      try {
        const session = await api.getGroundStationSession(selectedSessionId);
        if (isMounted) {
          setSessionDetail(session);
          if (session?.packets?.length) {
            setSelectedPacketId((current) => current || session.packets[0].packetId);
          }
        }
      } finally {
        if (isMounted) {
          setLoading((current) => ({ ...current, sessionDetail: false }));
        }
      }
    }

    void fetchSession();
    return () => {
      isMounted = false;
    };
  }, [selectedSessionId]);

  function updateSequenceRow(index, updates) {
    setSequence((current) =>
      current.map((row, rowIndex) => {
        if (rowIndex !== index) {
          return row;
        }

        const nextRow = { ...row, ...updates };
        if (updates.type) {
          nextRow.parameters = {};
          const definition = getCommandDefinition(updates.type);
          if (definition?.parameters?.length) {
            for (const parameter of definition.parameters) {
              nextRow.parameters[parameter.name] = parameter.type === "select" ? parameter.options[0] : "";
            }
          }
        }

        return nextRow;
      }),
    );
  }

  function addSequenceRow() {
    setSequence((current) => [...current, createSequenceRow()]);
  }

  function removeSequenceRow(index) {
    setSequence((current) => {
      if (current.length === 1) {
        return [createSequenceRow()];
      }
      return current.filter((_, rowIndex) => rowIndex !== index);
    });
  }

  async function persistSequence() {
    if (!validSequence.length) {
      throw new Error("Add at least one supported command to the mission sequence.");
    }

    const session = await api.createGroundStationSession({
      operatorId,
      commands: validSequence,
    });

    setSelectedSessionId(session.sessionId);
    setSessionDetail(session);
    setSelectedPacketId(session.packets?.[0]?.packetId ?? "");
    await refreshDashboard();
    return session;
  }

  async function handleAnalyzeSequence() {
    setActionError("");
    setLoading((current) => ({ ...current, action: true }));
    try {
      const session = await persistSequence();
      const result = await api.submitGroundStationSession(session.sessionId);
      setAnalysisResult(result);
      setAttackResult(null);
      setReportSession(session);
      setAttackHistory([]);
      await refreshDashboard();
    } catch (error) {
      setActionError(error.message);
    } finally {
      setLoading((current) => ({ ...current, action: false }));
    }
  }

  async function handleAttack(type) {
    setActionError("");
    setLoading((current) => ({ ...current, action: true }));
    try {
      let result;
      if (type === "reorder") {
        const order = (sessionDetail?.packets ?? []).map((packet) => packet.packetId).reverse();
        if (!order.length) {
          throw new Error("Create or open a session before running a packet reorder test.");
        }
        result = await api.reorderSessionPackets({ sessionId: selectedSessionId, packetOrder: order });
      } else if (type === "analyze") {
        if (!selectedSessionId) {
          throw new Error("Open a session to run the sequence analysis attack lab.");
        }
        result = await api.analyzeSession({ sessionId: selectedSessionId });
      } else {
        const packetId = selectedPacketId || selectedSessionPackets[0]?.packetId;
        if (!packetId) {
          throw new Error("Select a packet before invoking a tamper, replay, duplicate, or burst test.");
        }

        if (type === "tamper") {
          result = await api.tamperPacket({
            packetId,
            mutation: { parameters: { orientation: ORIENTATION_OPTIONS[2] } },
          });
        } else if (type === "replay") {
          result = await api.replayPacket({ packetId });
        } else if (type === "duplicate") {
          result = await api.duplicatePacket({ packetId, count: 2 });
        } else if (type === "burst") {
          result = await api.burstPacket({ packetId, count: 5 });
        }
      }

      setAttackResult({ type, result });
      setAttackHistory((current) => [...current, { type, result, timestamp: new Date().toISOString() }]);
      await refreshDashboard();
    } catch (error) {
      setActionError(error.message);
    } finally {
      setLoading((current) => ({ ...current, action: false }));
    }
  }

  async function runScenario(scenario) {
    setActionError("");
    setLoading((current) => ({ ...current, action: true }));
    try {
      const result = await api.runScenario(scenario.id);
      setAnalysisResult(result);
      setReportSession(null);
      setAttackHistory([]);
      setAttackResult(null);
      await refreshDashboard();
    } catch (error) {
      setActionError(error.message);
    } finally {
      setLoading((current) => ({ ...current, action: false }));
    }
  }

  async function resetDemo() {
    if (!window.confirm("Reset the local SAT Guard prototype state?")) return;
    setActionError("");
    setLoading((current) => ({ ...current, action: true }));
    try {
      await api.resetDemo();
      setSequence([createSequenceRow()]);
      setAnalysisResult(null);
      setAttackResult(null);
      setReportSession(null);
      setAttackHistory([]);
      setSelectedSessionId("");
      setSelectedPacketId("");
      setSessionDetail(null);
      await refreshDashboard();
    } catch (error) {
      setActionError(error.message);
    } finally {
      setLoading((current) => ({ ...current, action: false }));
    }
  }

  async function exportAnalysisPdf() {
    setActionError("");
    try {
      const [{ jsPDF }, { default: autoTable }] = await Promise.all([
        import("jspdf"),
        import("jspdf-autotable"),
      ]);
      const sequence = analysisResult?.sequenceAnalysis ?? {};
      const decisions = Array.isArray(analysisResult?.decisions) ? analysisResult.decisions : [];
      const packets = reportSession?.packets ?? [];
      const commandTypes = sequence.orderedCommandTypes ?? sequence.commandTypes ?? [];
      const generatedAt = new Date().toLocaleString();
      const sessionId = reportSession?.sessionId ?? analysisResult?.sessionId ?? "Not available";
      const reportOperatorId = reportSession?.operatorId ?? "Not available";
      const commandRows = packets.length
        ? packets.map((packet, index) => {
          const command = packet.command ?? {};
          const decision = decisions[index] ?? {};
          const parameters = Object.keys(command.parameters ?? {}).length
            ? JSON.stringify(command.parameters)
            : "No parameters";
          const gatewayAction = decision.action?.type === "ENQUEUED"
            ? `Queued (${decision.action.status ?? "pending"})`
            : decision.action?.type === "HELD"
              ? "Held"
              : decision.action?.type === "QUARANTINED"
                ? "Quarantined"
                : decision.action?.type ?? "No action returned";
          return [
            index + 1,
            command.type ?? "Unknown",
            parameters,
            packet.packetId ?? "Not available",
            command.timestamp ?? packet.createdAt ?? "Not recorded",
            decision.decision ?? "Not evaluated",
            gatewayAction,
            decision.reason ?? "No reason returned",
          ];
        })
        : commandTypes.map((commandType, index) => [
          index + 1,
          commandType,
          "Command detail was not included in the analysis response.",
          "",
          "",
          "",
          "",
          "",
        ]);
      const attackRows = attackHistory.map((attack) => {
        const details = getAttackReportDetails(attack);
        return [details.label, details.target, details.outcome, details.decisions, details.timestamp];
      });
      const sequenceOutcome = sequence.safe == null ? "Not evaluated" : sequence.safe ? "SAFE" : "UNSAFE";
      const pdf = new jsPDF({ unit: "mm", format: "a4" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const margin = 14;
      let y = 18;

      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(20);
      pdf.setTextColor(24, 60, 52);
      pdf.text("SAT Guard Security Report", margin, y);
      y += 8;
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(10);
      pdf.setTextColor(89, 104, 95);
      pdf.text("Sequence analysis and controlled attack-lab activity", margin, y);
      y += 6;
      pdf.text(`Generated ${generatedAt}`, margin, y);
      y += 10;

      const summary = [
        ["Session", sessionId],
        ["Operator", reportOperatorId],
        ["Sequence result", sequenceOutcome],
        ["Commands", String(sequence.totalCommands ?? (packets.length || commandTypes.length))],
        ["Accepted", String(analysisResult?.summary?.accepted ?? "Not provided")],
        ["Rejected / quarantined", String(analysisResult?.summary?.rejected ?? "Not provided")],
        ["Planner status", sequence.planner?.status ?? "Not evaluated"],
        ["Suspicious burst", sequence.burstSignal?.type ?? "Not detected"],
      ];
      const cardGap = 3;
      const cardWidth = (pageWidth - margin * 2 - cardGap * 3) / 4;
      for (let index = 0; index < summary.length; index += 1) {
        const column = index % 4;
        const row = Math.floor(index / 4);
        const x = margin + column * (cardWidth + cardGap);
        const cardY = y + row * 18;
        pdf.setDrawColor(213, 222, 216);
        pdf.setFillColor(246, 248, 246);
        pdf.roundedRect(x, cardY, cardWidth, 15, 1.5, 1.5, "FD");
        pdf.setFontSize(7);
        pdf.setTextColor(91, 107, 98);
        pdf.text(summary[index][0].toUpperCase(), x + 2.5, cardY + 4);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(8);
        pdf.setTextColor(23, 35, 31);
        const valueLines = pdf.splitTextToSize(String(summary[index][1]), cardWidth - 5);
        pdf.text(valueLines.slice(0, 2), x + 2.5, cardY + 8.5);
        pdf.setFont("helvetica", "normal");
      }
      y += 42;

      const addSectionTitle = (title) => {
        if (y > 260) {
          pdf.addPage();
          y = 18;
        }
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(13);
        pdf.setTextColor(40, 86, 74);
        pdf.text(title, margin, y);
        y += 3;
      };
      const tableStyles = {
        startY: y,
        margin: { left: margin, right: margin },
        styles: { font: "helvetica", fontSize: 7, cellPadding: 2.1, overflow: "linebreak", valign: "top" },
        headStyles: { fillColor: [237, 242, 238], textColor: [41, 74, 62], fontStyle: "bold" },
        alternateRowStyles: { fillColor: [248, 250, 248] },
        theme: "grid",
      };

      addSectionTitle("Commands received and analyzed");
      autoTable(pdf, {
        ...tableStyles,
        startY: y,
        head: [["#", "Command", "Parameters", "Packet ID", "Received", "Decision", "Gateway action", "Reason"]],
        body: commandRows.length ? commandRows : [["", "No command details were returned.", "", "", "", "", "", ""]],
        columnStyles: {
          0: { cellWidth: 7 },
          1: { cellWidth: 21 },
          2: { cellWidth: 27 },
          3: { cellWidth: 29 },
          4: { cellWidth: 24 },
          5: { cellWidth: 19 },
          6: { cellWidth: 20 },
        },
      });
      y = pdf.lastAutoTable.finalY + 10;

      addSectionTitle("Attack simulations performed");
      autoTable(pdf, {
        ...tableStyles,
        startY: y,
        head: [["Test", "Target packet/session", "Gateway result", "Decision", "Recorded"]],
        body: attackRows.length ? attackRows : [["No attack-lab simulations were run for this session.", "", "", "", ""]],
        columnStyles: {
          0: { cellWidth: 25 },
          1: { cellWidth: 33 },
          2: { cellWidth: 58 },
          3: { cellWidth: 28 },
        },
      });
      y = pdf.lastAutoTable.finalY + 10;

      if (y > 265) {
        pdf.addPage();
        y = 18;
      }
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(13);
      pdf.setTextColor(40, 86, 74);
      pdf.text("Analysis summary", margin, y);
      y += 6;
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      pdf.setTextColor(23, 35, 31);
      const summaryLines = pdf.splitTextToSize(
        sequence.reason ?? "No sequence analysis summary was returned.",
        pageWidth - margin * 2,
      );
      pdf.text(summaryLines, margin, y);
      y += summaryLines.length * 4.5 + 7;
      pdf.setFontSize(8);
      pdf.setTextColor(89, 104, 95);
      pdf.text(
        pdf.splitTextToSize(
          "This report records SAT Guard prototype analysis and controlled attack-lab simulations. It does not certify real spacecraft operations.",
          pageWidth - margin * 2,
        ),
        margin,
        y,
      );

      const pageCount = pdf.getNumberOfPages();
      for (let page = 1; page <= pageCount; page += 1) {
        pdf.setPage(page);
        pdf.setFontSize(8);
        pdf.setTextColor(107, 119, 111);
        pdf.text(
          `SAT GUARD - MISSION SECURITY OPERATIONS  |  ${page} / ${pageCount}`,
          pageWidth / 2,
          pdf.internal.pageSize.getHeight() - 8,
          { align: "center" },
        );
      }

      const safeSessionId = String(sessionId).replace(/[^a-z0-9_-]/gi, "_");
      pdf.save(`sat-guard-security-report-${safeSessionId}.pdf`);
    } catch (error) {
      setActionError(`Could not generate PDF report: ${error.message}`);
    }
  }

  if (!hasEntered) {
    return <WelcomeScreen onEnter={() => setHasEntered(true)} />;
  }

  return (
    <main className="mission-shell">
      <header className="mission-header">
        <div className="brand-block">
          <div className="brand-badge">OG</div>
          <div>
            <div className="brand-name">SAT <span>GUARD</span></div>
            <div className="brand-subtitle">Mission Security Operations Center</div>
          </div>
        </div>

        <div className="header-actions">
          <div className={`status-pill ${connected ? "online" : "offline"}`}>
            <span className="status-dot" />
            {connected ? "GATEWAY ONLINE" : "CONNECTION OFFLINE"}
          </div>
          <button className="small-button" type="button" onClick={() => void refreshDashboard()} disabled={loading.action}>
            Refresh
          </button>
          <button className="small-button small-button-warning" type="button" onClick={resetDemo} disabled={loading.action}>
            Reset demo
          </button>
        </div>
      </header>

      {actionError && <div className="action-alert" role="alert">{actionError}</div>}

      <section className="mission-hero" aria-label="Mission control overview">
        <div className="hero-copy">
          <div className="hero-kicker"><span className="hero-kicker-dot" /> ORBITAL DEFENSE NETWORK <span>·</span> MISSION 08</div>
          <h1>Watching over<br /><em>your world.</em></h1>
          <p>Every command, every orbit, every signal — monitored and protected in real time.</p>
          <div className="hero-status">
            <span className={`hero-status-icon ${connected ? "is-online" : ""}`}>{connected ? "✓" : "!"}</span>
            <span><strong>{connected ? "All systems operational" : "Gateway connection offline"}</strong><small>Spacecraft security gateway</small></span>
          </div>
          <div className="hero-coordinates"><span>MISSION CONTROL</span><i /> <span>LOW EARTH ORBIT</span><i /> <span>24/7 MONITORING</span></div>
        </div>
        <InteractiveGlobe />
        <div className="hero-index">01 <span>/</span> ORBITAL OVERVIEW</div>
      </section>

      <section className="metrics-grid" aria-label="Mission overview metrics">
        <MetricCard label="Gateway" value={health?.status ?? "offline"} tone={connected ? "good" : "bad"} />
        <MetricCard label="Battery" value={spacecraft?.battery != null ? `${spacecraft.battery}%` : "—"} tone="good" />
        <MetricCard label="Fuel" value={spacecraft?.fuel != null ? `${spacecraft.fuel}%` : "—"} tone="neutral" />
        <MetricCard label="Temp" value={spacecraft?.temperature != null ? `${spacecraft.temperature}°C` : "—"} tone={spacecraft && spacecraft.temperature > 40 ? "bad" : "neutral"} />
        <MetricCard label="Queue" value={String(queue.length)} tone="neutral" />
        <MetricCard label="Held" value={String(held.length)} tone="warn" />
        <MetricCard label="Events" value={String(events.length)} tone="neutral" />
        <MetricCard label="Sessions" value={String(sessions.length)} tone="good" />
      </section>

      <div className="mission-layout">
        <div className="main-column">
          <section className="panel panel-large">
            <div className="panel-title-row">
              <div>
                <div className="eyebrow">GROUND STATION</div>
                <h2>Mission command sequence</h2>
              </div>
            </div>

            <div className="split-grid">
              <div className="command-form">
                <label>
                  <span>Operator</span>
                  <select value={operatorId} onChange={(event) => setOperatorId(event.target.value)}>
                    {OPERATOR_OPTIONS.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </label>

                <div className="builder-list">
                  {sequence.map((row, index) => {
                    const definition = getCommandDefinition(row.type);
                    return (
                      <div key={row.id} className="builder-item">
                        <label>
                          <span>Command</span>
                          <select
                            value={row.type}
                            onChange={(event) => updateSequenceRow(index, { type: event.target.value })}
                          >
                            <option value="">Select command…</option>
                            {COMMAND_DEFINITIONS.map((command) => (
                              <option key={command.value} value={command.value}>{command.label}</option>
                            ))}
                          </select>
                        </label>

                        <div className="packet-panel">
                          <div className="mini-header">Parameters</div>
                          {!definition ? (
                            <div className="empty-inline">Select a backend-supported command to configure parameters.</div>
                          ) : definition.parameters.length === 0 ? (
                            <div className="empty-inline">No parameters required for this command.</div>
                          ) : (
                            definition.parameters.map((parameter) => (
                              <label key={`${row.id}-${parameter.name}`}>
                                <span>{parameter.name}</span>
                                {parameter.type === "select" ? (
                                  <select
                                    value={row.parameters?.[parameter.name] ?? parameter.options[0]}
                                    onChange={(event) =>
                                      updateSequenceRow(index, {
                                        parameters: {
                                          ...row.parameters,
                                          [parameter.name]: event.target.value,
                                        },
                                      })
                                    }
                                  >
                                    {parameter.options.map((option) => (
                                      <option key={option} value={option}>{option}</option>
                                    ))}
                                  </select>
                                ) : (
                                  <input
                                    type="text"
                                    value={row.parameters?.[parameter.name] ?? ""}
                                    onChange={(event) =>
                                      updateSequenceRow(index, {
                                        parameters: {
                                          ...row.parameters,
                                          [parameter.name]: event.target.value,
                                        },
                                      })
                                    }
                                  />
                                )}
                              </label>
                            ))
                          )}
                        </div>

                        <div className="builder-actions">
                          <button type="button" className="remove-button" onClick={() => removeSequenceRow(index)}>
                            Remove
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="builder-actions">
                  <button className="small-button" type="button" onClick={addSequenceRow}>
                    Add command
                  </button>
                  <button className="primary-button" type="button" onClick={() => void handleAnalyzeSequence()} disabled={loading.action}>
                    {loading.action ? "Analyzing…" : "Analyze sequence"}
                  </button>
                </div>
              </div>

              <div className="packet-panel">
                <div className="mini-header">Sequence summary</div>
                <div className="result-list">
                  <div className="result-item emphasis">
                    <strong>Session</strong>
                    <span>{selectedSessionId || "SESSION-PENDING"}</span>
                  </div>
                  <div className="result-item">
                    <strong>Operator</strong>
                    <span>{operatorId}</span>
                  </div>
                  <div className="result-item">
                    <strong>Command count</strong>
                    <span>{validSequence.length}</span>
                  </div>
                  <div className="result-item">
                    <strong>Order</strong>
                    <span>{validSequence.length ? validSequence.map((command) => command.type).join(" → ") : "No commands selected"}</span>
                  </div>
                  <div className="result-item">
                    <strong>Decision</strong>
                    <span>{analysisResult?.decisions?.[0]?.decision ?? "AWAITING_ANALYSIS"}</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="panel panel-large">
            <div className="panel-title-row">
              <div>
                <div className="eyebrow">SATGUARD</div>
                <h2>Sequence and security analysis</h2>
              </div>
              {analysisResult && (
                <div className="header-actions">
                  <button className="small-button" type="button" onClick={exportAnalysisPdf}>
                    Export PDF report
                  </button>
                  <button className="small-button" type="button" onClick={() => setShowTechnical((current) => !current)}>
                    {showTechnical ? "Hide technical response" : "View technical response"}
                  </button>
                </div>
              )}
            </div>

            {!analysisResult ? (
              <div className="empty-inline">No sequence decision yet. Build a real command sequence, then submit it to SATGUARD for backend validation.</div>
            ) : (
              <AnalysisReport result={analysisResult} spacecraft={spacecraft} />
            )}

            {analysisResult && showTechnical && (
              <div className="technical-response">
                <div className="technical-header">TECHNICAL RESPONSE</div>
                <pre>{JSON.stringify(analysisResult, null, 2)}</pre>
              </div>
            )}
          </section>

          <section className="panel panel-large">
            <div className="panel-title-row">
              <div>
                <div className="eyebrow">ATTACK LAB</div>
                <h2>Packet and sequence testing</h2>
              </div>
            </div>

            <div className="attack-controls">
              <button className="small-button small-button-warning" type="button" onClick={() => void handleAttack("tamper")} disabled={loading.action}>Tamper packet</button>
              <button className="small-button" type="button" onClick={() => void handleAttack("replay")} disabled={loading.action}>Replay packet</button>
              <button className="small-button" type="button" onClick={() => void handleAttack("duplicate")} disabled={loading.action}>Duplicate packet</button>
              <button className="small-button" type="button" onClick={() => void handleAttack("burst")} disabled={loading.action}>Burst packet</button>
              <button className="small-button" type="button" onClick={() => void handleAttack("reorder")} disabled={loading.action}>Reorder sequence</button>
              <button className="small-button" type="button" onClick={() => void handleAttack("analyze")} disabled={loading.action}>Analyze session</button>
            </div>

            {!attackResult ? (
              <div className="empty-inline">No controlled attack test has been executed yet. Select a signed packet or open a session to feed the real backend attack-lab flow.</div>
            ) : (
              <div className="result-stack action-result">
                <div className="result-banner attack-banner">
                  <span>{String(attackResult.type).toUpperCase()}</span>
                  <strong>Attack simulation report</strong>
                </div>
                <AttackReport attack={attackResult} />
                <details className="technical-response">
                  <summary>View technical response</summary>
                  <pre>{JSON.stringify(attackResult.result, null, 2)}</pre>
                </details>
              </div>
            )}
          </section>
        </div>

        <aside className="side-column">
          <section className="panel side-panel">
            <div className="panel-title-row">
              <div>
                <div className="eyebrow">GROUND STATION</div>
                <h2>Active sessions</h2>
              </div>
            </div>
            <div className="session-list">
              {sessions.length ? (
                sessions.map((session) => (
                  <button
                    key={session.sessionId}
                    type="button"
                    className={`session-item ${selectedSessionId === session.sessionId ? "selected" : ""}`}
                    onClick={() => setSelectedSessionId(session.sessionId)}
                  >
                    <strong>{session.sessionId}</strong>
                    <span>{session.operatorId}</span>
                    <small>{session.packets?.length ?? 0} packets</small>
                  </button>
                ))
              ) : (
                <div className="empty-inline">No ground-station sessions yet.</div>
              )}
            </div>
          </section>

          <section className="panel side-panel">
            <div className="panel-title-row">
              <div>
                <div className="eyebrow">PACKETS</div>
                <h2>Signed command packets</h2>
              </div>
            </div>
            <div className="session-list">
              {selectedSessionPackets.length ? (
                selectedSessionPackets.map((packet) => (
                  <button
                    key={packet.packetId}
                    type="button"
                    className={`session-item ${selectedPacketId === packet.packetId ? "selected" : ""}`}
                    onClick={() => setSelectedPacketId(packet.packetId)}
                  >
                    <strong>{packet.packetId}</strong>
                    <span>{packet.command?.type ?? "UNKNOWN_COMMAND"}</span>
                    <small>{packet.signature ?? "signature-redacted"}</small>
                  </button>
                ))
              ) : (
                <div className="empty-inline">No packet selected for this session.</div>
              )}
            </div>
          </section>

          <section className="panel side-panel">
            <div className="panel-title-row">
              <div>
                <div className="eyebrow">COMMAND QUEUE</div>
                <h2>Pending execution</h2>
              </div>
            </div>
            {queue.length ? (
              <ul className="queue-list">
                {queue.slice(0, 6).map((command) => (
                  <li key={command.id ?? `${command.type}-${command.sequence}`}>
                    <span>{command.type}</span>
                    <small>{command.status ?? "QUEUED"}</small>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="empty-inline">Queue is clear.</div>
            )}
          </section>

          <section className="panel side-panel">
            <div className="panel-title-row">
              <div>
                <div className="eyebrow">EVENT FEED</div>
                <h2>Security timeline</h2>
              </div>
            </div>
            <div className="event-feed">
              {events.length ? (
                events.slice(0, 8).map((event) => (
                  <div key={event.id ?? `${event.type}-${event.timestamp}`} className="event-item">
                    <span className="event-pill">{event.severity ?? "INFO"}</span>
                    <div>
                      <strong>{event.type?.replaceAll("_", " ") ?? "EVENT"}</strong>
                      <small>{event.message ?? "No message"}</small>
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty-inline">No security events recorded.</div>
              )}
            </div>
          </section>

          <section className="panel side-panel">
            <div className="panel-title-row">
              <div>
                <div className="eyebrow">SECURITY LAB</div>
                <h2>Regression tests</h2>
              </div>
            </div>
            {scenarios.length ? (
              <div className="scenario-list">
                {scenarios.slice(0, 6).map((scenario) => (
                  <button key={scenario.id} type="button" className="scenario-button" onClick={() => void runScenario(scenario)}>
                    <strong>{scenario.title}</strong>
                    <span>{scenario.category}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="empty-inline">No scenarios available.</div>
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}

function MetricCard({ label, value, tone }) {
  return (
    <div className={`metric-card tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function AnalysisReport({ result, spacecraft }) {
  const sequence = result?.sequenceAnalysis ?? {};
  const decisions = Array.isArray(result?.decisions) ? result.decisions : [];
  const latestDecision = decisions[decisions.length - 1] ?? {};
  const checks = latestDecision?.security?.checks ?? {};
  const commandOrder = getCommandOrder(sequence, decisions);
  const repeated = Array.isArray(sequence.repeatedCommandTypes) ? sequence.repeatedCommandTypes : [];
  const accepted = Number.isFinite(result?.summary?.accepted) ? result.summary.accepted : decisions.filter((entry) => ["ALLOW", "WATCH", "HOLD"].includes(entry.decision)).length;
  const rejected = Number.isFinite(result?.summary?.rejected) ? result.summary.rejected : decisions.filter((entry) => ["REJECTED", "QUARANTINE", "SAFE_MODE"].includes(entry.decision)).length;
  const finalDecision = latestDecision.decision ?? sequence?.decision ?? "Not provided";
  const consequence = sequence.consequence ?? latestDecision.consequence ?? {};
  const planner = sequence.planner ?? latestDecision.planner ?? {};
  const behaviourState = repeated.length ? "⚠ WATCH" : "✓ PASS";
  const securityList = [
    { label: "Authentication", value: checks.authentication?.passed == null ? "Not evaluated" : checks.authentication.passed ? "✓ PASS" : "✗ FAIL" },
    { label: "Authorization", value: checks.authorization?.passed == null ? "Not evaluated" : checks.authorization.passed ? "✓ PASS" : "✗ FAIL" },
    { label: "Validation", value: checks.commandValidation?.passed == null ? "Not evaluated" : checks.commandValidation.passed ? "✓ PASS" : "✗ FAIL" },
    { label: "Integrity", value: checks.integrity?.passed == null ? "Not evaluated" : checks.integrity.passed ? "✓ PASS" : "✗ FAIL" },
    { label: "Replay protection", value: checks.replay?.passed == null ? "Not evaluated" : checks.replay.passed ? "✓ PASS" : "✗ FAIL" },
    { label: "Behaviour", value: repeated.length ? "⚠ WATCH" : "✓ PASS" },
    { label: "Consequence", value: consequence?.safe == null ? "Not evaluated" : consequence.safe ? "✓ SAFE" : "✗ UNSAFE" },
    { label: "Planner", value: planner?.status ?? "Not evaluated" },
  ];

  return (
    <div className="analysis-report">
      <div className="analysis-section">
        <div className="analysis-heading">SATGUARD ANALYSIS</div>
        <div className="analysis-box">
          <div className="box-heading">COMMAND SEQUENCE</div>
          <div className="report-grid">
            <div><span>Commands analyzed</span><strong>{formatCount(sequence.totalCommands ?? commandOrder.length)}</strong></div>
            <div><span>Unique command types</span><strong>{uniqueCount(commandOrder)}</strong></div>
            <div><span>Repeated commands</span><strong>{repeated.length ? repeated.map((item) => `${item.type} (${item.count}×)`).join(", ") : "Not provided"}</strong></div>
          </div>
          <div className="command-order">
            {commandOrder.length ? commandOrder.flatMap((command, index) => [
              <div key={`${command}-row-${index}`} className="order-row"><span>{String(index + 1).padStart(2, "0")}</span><strong>{command}</strong></div>,
              index < commandOrder.length - 1 ? <div key={`${command}-arrow-${index}`} className="order-arrow">↓</div> : null,
            ]) : <div className="empty-inline">No command order available.</div>}
          </div>
        </div>
      </div>

      <div className="analysis-section">
        <div className="analysis-heading">BEHAVIOUR ANALYSIS</div>
        <div className="analysis-box">
          {repeated.length ? (
            <>
              <div className="report-row"><span>Repeated command detected</span><strong>{repeated.map((item) => `${item.type} × ${item.count}`).join("; ")}</strong></div>
              <div className="report-row"><span>Frequency</span><strong>{repeated.map((item) => `${item.count} / sequence`).join("; ")}</strong></div>
              <div className="report-row"><span>Behaviour signal</span><strong>{sequence.burstSignal?.type ?? behaviourState}</strong></div>
              <div className="report-row"><span>Result</span><strong>{sequence.reason ?? "Not provided"}</strong></div>
            </>
          ) : (
            <div className="report-row"><span>Behaviour</span><strong>✓ No suspicious behaviour detected</strong></div>
          )}
        </div>
      </div>

      <div className="analysis-section">
        <div className="analysis-heading">SEQUENCE ANALYSIS</div>
        <div className="analysis-box">
          <div className="report-row"><span>Order</span><strong>{sequence.safe === false ? "WARNING" : sequence.safe === true ? "PASS" : "Not evaluated"}</strong></div>
          <div className="report-row"><span>Dependencies</span><strong>{sequence.dependencyViolations?.length ? "WARNING" : "PASS"}</strong></div>
          <div className="report-row"><span>Consequence</span><strong>{consequence?.safe == null ? "Not evaluated" : consequence.safe ? "SAFE" : "UNSAFE"}</strong></div>
          <div className="report-row"><span>Execution planner</span><strong>{planner?.status ?? "Not evaluated"}</strong></div>
        </div>
      </div>

      <div className="analysis-section">
        <div className="analysis-heading">SECURITY CHECKS</div>
        <div className="analysis-box">
          <div className="security-check-list">
            {securityList.map((check) => (
              <div key={check.label} className="security-check-item">
                <span>{check.label}</span>
                <strong>{check.value}</strong>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="analysis-section decision-panel">
        <div className="analysis-heading">SECURITY DECISION</div>
        <div className="decision-card">
          <div className="decision-title">{finalDecision}</div>
          <div className="decision-body">
            <div><span>Reason</span><strong>{latestDecision.reason ?? sequence.reason ?? "Not provided"}</strong></div>
            <div><span>Spacecraft execution</span><strong>{latestDecision.action?.type === "ENQUEUED" ? "ALLOWED" : latestDecision.action?.type === "HELD" ? "HELD" : latestDecision.action?.type === "QUARANTINED" ? "BLOCKED" : "Not evaluated"}</strong></div>
          </div>
        </div>
      </div>

      <div className="analysis-section">
        <div className="analysis-heading">MISSION CONSEQUENCE</div>
        <div className="analysis-box">
          <div className="report-row"><span>Current spacecraft state</span><strong>{summarizeState(consequence?.initialState ?? latestDecision?.consequence?.initialState ?? spacecraft)}</strong></div>
          <div className="report-row"><span>Predicted result</span><strong>{consequence?.safe == null ? "Not evaluated" : consequence.safe ? "SAFE" : "UNSAFE"}</strong></div>
          <div className="report-row"><span>Safety constraints</span><strong>{summarizeConstraints(consequence?.violations ?? [])}</strong></div>
        </div>
      </div>

      <div className="analysis-section">
        <div className="analysis-heading">EXECUTION PLANNER</div>
        <div className="analysis-box">
          <div className="report-row"><span>Status</span><strong>{planner?.status ?? "NOT REQUIRED"}</strong></div>
          {planner?.status === "SAFE_REORDER_FOUND" && (
            <>
              <div className="report-row"><span>Received order</span><strong>{commandOrder.length ? commandOrder.join(" → ") : "Not provided"}</strong></div>
              <div className="report-row"><span>Suggested safe order</span><strong>{planner?.suggestedOrder ? planner.suggestedOrder.join(" → ") : "Not provided"}</strong></div>
            </>
          )}
          {planner?.status === "NO_SAFE_PLAN" && <div className="report-row"><span>Reason</span><strong>{planner.reason ?? "Not provided"}</strong></div>}
        </div>
      </div>

      <div className="analysis-section">
        <div className="analysis-heading">COMMAND RESULT</div>
        <div className="result-summary-grid">
          <div className="summary-box accepted"><span>ACCEPTED</span><strong>{accepted}</strong></div>
          <div className="summary-box rejected"><span>REJECTED</span><strong>{rejected}</strong></div>
        </div>
      </div>
    </div>
  );
}

function getCommandOrder(sequence, decisions) {
  const fromSequence = sequence?.orderedCommandTypes ?? sequence?.commandTypes ?? [];
  if (Array.isArray(fromSequence) && fromSequence.length) return fromSequence;
  if (Array.isArray(decisions) && decisions.length) {
    return decisions.map((decision) => decision.command?.type ?? decision.type ?? "UNKNOWN").filter(Boolean);
  }
  return [];
}

function uniqueCount(values) {
  return new Set(values.filter(Boolean)).size;
}

function formatCount(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function summarizeState(state) {
  if (!state || typeof state !== "object") return "Not provided";
  const entries = Object.entries(state)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .slice(0, 6)
    .map(([key, value]) => `${key}: ${value}`);
  return entries.length ? entries.join(" | ") : "Not provided";
}

function summarizeConstraints(violations) {
  if (!Array.isArray(violations) || !violations.length) return "✓ No constraint violations";
  return violations.map((entry) => entry?.reason ?? entry?.type ?? String(entry)).join("; ");
}

function AttackReport({ attack }) {
  const payload = attack.result?.result ?? attack.result ?? {};
  const analysis = attack.type === "analyze" ? attack.result?.analysis : null;
  const evaluations = Array.isArray(payload.evaluations)
    ? payload.evaluations
    : Array.isArray(payload.results)
      ? payload.results
      : payload.result?.decision
        ? [payload.result]
        : [];
  const decisions = evaluations.map((entry) => entry?.decision).filter(Boolean);
  const decisionSummary = [...new Set(decisions)].join(" / ") || "No decision returned";
  const packet = payload.packet ?? payload.originalPacket ?? null;
  const originalType = payload.originalPacket?.command?.type;
  const modifiedType = payload.tamperedPacket?.command?.type;

  if (analysis) {
    return (
      <div className="attack-report">
        <div className="attack-report-grid">
          <div><span>Session</span><strong>{attack.result.sessionId ?? "Not provided"}</strong></div>
          <div><span>Commands analyzed</span><strong>{analysis.totalCommands ?? "Not provided"}</strong></div>
          <div><span>Sequence safety</span><strong>{analysis.safe == null ? "Not evaluated" : analysis.safe ? "SAFE" : "UNSAFE"}</strong></div>
          <div><span>Planner</span><strong>{analysis.planner?.status ?? "Not provided"}</strong></div>
        </div>
        <div className="report-row"><span>Analysis result</span><strong>{analysis.reason ?? "Not provided"}</strong></div>
        {Array.isArray(analysis.dependencyViolations) && analysis.dependencyViolations.length > 0 && (
          <div className="report-row"><span>Dependency violations</span><strong>{analysis.dependencyViolations.map((entry) => entry?.reason ?? entry?.type ?? "Violation").join("; ")}</strong></div>
        )}
      </div>
    );
  }

  return (
    <div className="attack-report">
      <div className="attack-report-grid">
        <div><span>Backend decision{decisions.length === 1 ? "" : "s"}</span><strong>{decisionSummary}</strong></div>
        <div><span>Evaluations</span><strong>{evaluations.length || "Not provided"}</strong></div>
        {attack.result?.packetId && <div><span>Packet</span><strong>{attack.result.packetId}</strong></div>}
        {attack.result?.sessionId && <div><span>Session</span><strong>{attack.result.sessionId}</strong></div>}
      </div>

      {attack.type === "tamper" && (
        <div className="report-row"><span>Signed command change</span><strong>{originalType && modifiedType ? `${originalType} → ${modifiedType}` : "Command payload modified; see packet details"}</strong></div>
      )}
      {attack.type === "burst" && payload.burstCount != null && (
        <div className="report-row"><span>Burst submissions</span><strong>{payload.burstCount}</strong></div>
      )}
      {attack.type === "reorder" && Array.isArray(payload.packetOrder) && (
        <div className="report-row"><span>Submitted packet order</span><strong>{payload.packetOrder.join(" → ")}</strong></div>
      )}
      {packet?.command?.type && <div className="report-row"><span>Command</span><strong>{packet.command.type}</strong></div>}

      {evaluations.length > 0 && (
        <div className="attack-evaluations">
          {evaluations.map((evaluation, index) => (
            <div className="attack-evaluation" key={`${evaluation.commandId ?? evaluation.command?.id ?? "evaluation"}-${index}`}>
              <strong>{evaluation.command?.type ?? `Evaluation ${index + 1}`}</strong>
              <span className="evaluation-decision">{evaluation.decision ?? "No decision returned"}</span>
              {evaluation.security?.failedStage && <span>Failed check: {evaluation.security.failedStage}</span>}
              {evaluation.reason && <span>{evaluation.reason}</span>}
              {evaluation.signals?.length > 0 && <span>Signals: {evaluation.signals.map((signal) => signal.type).filter(Boolean).join(", ")}</span>}
            </div>
          ))}
        </div>
      )}

      {attack.result?.explanation && <div className="attack-explanation">{attack.result.explanation}</div>}
    </div>
  );
}

export default App;
