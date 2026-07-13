import { useState } from "react";
import { useMutation, useAction, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import "./App.css";

const STAGES = ["drafting", "negotiating", "awaiting_human", "resolved"] as const;
const STAGE_LABELS: Record<string, string> = {
  drafting: "Drafted",
  negotiating: "Negotiating",
  auto_resolved: "Resolved",
  awaiting_human: "Awaiting Human",
  resolved: "Resolved",
};

function agentLabel(agent: string) {
  if (agent === "eng_manager") return "Engineering";
  if (agent === "finance") return "Finance";
  return "Ledger";
}

function decisionStamp(message: string): { word: string; tone: string } | null {
  const m = message.toLowerCase();
  if (m.includes("auto-approve") || m.includes("approved")) return { word: "Approved", tone: "approve" };
  if (m.includes("auto-reject") || m.includes("rejected")) return { word: "Rejected", tone: "reject" };
  if (m.includes("escalate")) return { word: "Escalated", tone: "escalate" };
  return null;
}

export default function App() {
  const [role, setRole] = useState("Senior Backend Engineer");
  const [level, setLevel] = useState("Senior");
  const [salary, setSalary] = useState(180000);
  const [justification, setJustification] = useState(
    "We're blocked on the payments migration without another senior backend hire."
  );
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);

  const createRequest = useMutation(api.hiringRequests.createRequest);
  const runNegotiation = useAction(api.agents.runNegotiation);

  const requests = useQuery(api.hiringRequests.listActiveRequests) ?? [];
  const events =
    useQuery(
      api.hiringRequests.getAgentEvents,
      activeRequestId ? { requestId: activeRequestId } : "skip"
    ) ?? [];
  const activeRequest = useQuery(
    api.hiringRequests.getRequest,
    activeRequestId ? { requestId: activeRequestId } : "skip"
  );

  async function handleSubmit() {
    const requestId = await createRequest({
      role,
      level,
      salaryRequested: salary,
      justification,
    });
    setActiveRequestId(requestId);
    void runNegotiation({ requestId });
  }

  const stageIndex = activeRequest ? STAGES.indexOf(activeRequest.status as any) : -1;
  const isDone = activeRequest?.status === "resolved" || activeRequest?.status === "auto_resolved";

  return (
    <div className="ledger-app">
      <header className="ledger-header">
        <div className="wordmark">
          <span className="wordmark-mark">§</span>
          <span>HireLoop</span>
        </div>
        <p className="tagline">A requisition ledger for autonomous hiring decisions</p>
      </header>

      <div className="ledger-body">
        <aside className="requisition-card">
          <div className="card-label">New Requisition</div>

          <label className="field">
            <span>Role</span>
            <input value={role} onChange={(e) => setRole(e.target.value)} />
          </label>

          <label className="field">
            <span>Level</span>
            <select value={level} onChange={(e) => setLevel(e.target.value)}>
              <option>Junior</option>
              <option>Mid</option>
              <option>Senior</option>
              <option>Staff</option>
            </select>
          </label>

          <label className="field">
            <span>Salary Requested</span>
            <input
              type="number"
              value={salary}
              onChange={(e) => setSalary(Number(e.target.value))}
            />
          </label>

          <label className="field">
            <span>Justification</span>
            <textarea
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              rows={4}
            />
          </label>

          <button className="submit-btn" onClick={handleSubmit}>
            File Requisition
          </button>
        </aside>

        <main className="docket">
          {activeRequestId ? (
            <>
              <div className="docket-header">
                <div>
                  <div className="docket-eyebrow">Requisition No.</div>
                  <div className="docket-id">{activeRequestId}</div>
                </div>
                <div className="rail">
                  {STAGES.map((stage, i) => (
                    <div
                      key={stage}
                      className={
                        "rail-stop" +
                        (i <= stageIndex ? " rail-stop--passed" : "") +
                        (i === stageIndex && !isDone ? " rail-stop--current" : "")
                      }
                    >
                      <span className="rail-dot" />
                      <span className="rail-label">{STAGE_LABELS[stage]}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="memo-stack">
                {events.length === 0 && (
                  <div className="empty-note">Awaiting the first entry in the ledger…</div>
                )}
                {events.map((e) => {
                  const stamp = decisionStamp(e.message);
                  const agent = e.agent;
                  return (
                    <div
                      key={e._id}
                      className={`memo memo--${agent === "system" ? "system" : agent}`}
                    >
                      <div className="memo-tab">{agentLabel(agent)}</div>
                      <div className="memo-body">
                        <p>{e.message}</p>
                        {stamp && <span className={`stamp stamp--${stamp.tone}`}>{stamp.word}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="docket-placeholder">
              <p>No requisition selected.</p>
              <p className="muted">File a new one, or choose one from the register below.</p>
            </div>
          )}

          <section className="register">
            <div className="card-label">Register</div>
            <div className="register-list">
              {requests.map((r) => (
                <button
                  key={r._id}
                  className={
                    "register-row" + (r.requestId === activeRequestId ? " register-row--active" : "")
                  }
                  onClick={() => setActiveRequestId(r.requestId)}
                >
                  <span className="register-id">{r.requestId}</span>
                  <span className="register-role">{r.role}</span>
                  <span className={`status-pill status-pill--${r.status}`}>
                    {STAGE_LABELS[r.status] ?? r.status}
                  </span>
                </button>
              ))}
              {requests.length === 0 && <div className="empty-note">The register is empty.</div>}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}