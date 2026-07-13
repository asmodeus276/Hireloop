# Functional Requirements Document (FRD)
## HireLoop — Autonomous Hiring & Budget Approval System

**Project Track:** Cross-Track (Notion + Convex)
**Version:** 1.0
**Date:** July 12, 2026

---

## 1. Purpose

HireLoop is an AI-native workflow system in which two autonomous agents — an **Engineering Manager Agent** and a **Finance Agent** — negotiate a hiring request against company policy. When the agents can resolve the request within policy, they do so autonomously. When they cannot (budget conflict, ambiguous case), the workflow pauses and escalates to a human decision-maker, who reviews and resolves it inside Notion. Every step of the negotiation and the final decision is logged in a clean, human-legible, durable record.

This document defines **what** the system must do from a user and business-process perspective. Technical implementation is covered separately in the TRD.

---

## 2. Problem Statement

Companies run hiring and budget approvals across disconnected tools — spreadsheets, Slack threads, email — leading to:
- No single source of truth for why a hiring decision was made
- Manual, repetitive back-and-forth between Engineering and Finance
- No enforced checkpoint for human oversight on high-stakes decisions
- Poor auditability after the fact

HireLoop demonstrates a system where AI agents handle the repetitive negotiation, while humans retain final control over consequential outcomes, and every decision is traceable.

---

## 3. Goals and Objectives

| Goal | Description |
|---|---|
| G1 | Enable two agents to autonomously coordinate and resolve routine hiring requests without human input |
| G2 | Enforce a mandatory human-in-the-loop checkpoint for any request that falls outside policy or is ambiguous |
| G3 | Produce a clean, durable, human-readable audit trail for every request, resolved or escalated |
| G4 | Demonstrate the full loop live: request → negotiation → (auto-resolve OR human review) → final record |

---

## 4. Scope

### 4.1 In Scope
- Two agents: **Engineering Manager Agent**, **Finance Agent**
- One workflow: new hire request → budget/policy evaluation → resolution
- Autonomous approval path (within policy)
- Escalation path (outside policy / ambiguous) with human approve/reject/override
- Durable record of every decision and its reasoning in Notion
- Live activity view showing agent negotiation as it happens

### 4.2 Out of Scope (for this build)
- Full applicant tracking / candidate sourcing
- More than 2–3 business functions (explicitly avoiding shallow multi-agent sprawl)
- Payroll or HRIS system integration
- Multi-tenant / multi-company support
- Authentication beyond what's needed for the demo

### 4.3 Optional Stretch Scope
- A third agent, **HR Agent**, that drafts the offer letter and updates headcount records after approval

---

## 5. User Roles

| Role | Description |
|---|---|
| **Engineering Manager Agent** | Drafts hiring requests with role, level, salary, and justification |
| **Finance Agent** | Evaluates requests against company budget/headcount policy; approves, rejects, or escalates |
| **Human Reviewer** | A person who reviews escalated requests in Notion and makes the binding final call |
| **Demo Observer / Judge** | Views the live agent activity feed and the final Notion record |

---

## 6. Functional Requirements

### 6.1 Request Creation
- **FR-1:** The system shall allow a hiring request to be initiated (manually triggered for demo purposes, or from a seed script) with: role title, level, requested salary, and justification/urgency.
- **FR-2:** Upon creation, the Engineering Manager Agent shall generate a structured request object and log it as a runtime event.

### 6.2 Autonomous Negotiation
- **FR-3:** The Finance Agent shall retrieve current budget and headcount policy from the durable Notion policy store before evaluating any request.
- **FR-4:** The Finance Agent shall evaluate the request against policy and produce one of: **Auto-Approve**, **Auto-Reject**, or **Escalate**.
- **FR-5:** If Auto-Approve or Auto-Reject, the system shall resolve the request without human involvement and write the final outcome and reasoning to the durable record.
- **FR-6:** If the request is borderline, the Engineering Manager Agent shall be allowed one counter-justification before Finance makes a final automated call or escalates.
- **FR-7:** All agent-to-agent negotiation messages shall be logged as structured events visible in a live activity feed.

### 6.3 Human-in-the-Loop
- **FR-8:** If a request is escalated, the system shall set its status to "Awaiting Human Review" in the durable record and shall not proceed further without human input.
- **FR-9:** The durable record shall present the human reviewer with: the request details, both agents' reasoning, and the relevant policy reference — in clean, formatted form (no raw model output).
- **FR-10:** The human reviewer shall be able to Approve, Reject, or Override the request directly within Notion.
- **FR-11:** The system shall detect the human's decision via webhook (not polling) and resume the workflow automatically.

### 6.4 Traceability
- **FR-12:** Every request, regardless of resolution path, shall produce a complete, readable record showing: what was requested, what each agent said and why, whether a human intervened, and the final outcome.
- **FR-13:** The record shall be formatted for human readability — clear titles, status labels, and short reasoning summaries — not raw dumped model text.
- **FR-14:** All records shall be timestamped and retrievable after the fact.

### 6.5 Live Demo View
- **FR-15:** The system shall provide a live-updating view (web UI) showing agent activity as it happens, so an observer can watch the negotiation unfold in real time rather than only seeing the final result.

---

## 7. User Stories

- *As an Engineering Manager Agent*, I want to submit a hiring request with justification, so that Finance can evaluate it against current budget policy.
- *As a Finance Agent*, I want to check current budget policy before deciding, so that my decisions are grounded in real company constraints, not guesses.
- *As a Finance Agent*, I want to escalate ambiguous or over-budget requests, so that a human makes the final call on consequential decisions.
- *As a Human Reviewer*, I want to see a clean summary of both agents' reasoning in Notion, so that I can make an informed decision without reading raw logs.
- *As a Human Reviewer*, I want to approve, reject, or override a request with one click, so that the workflow resumes without extra tooling.
- *As a Judge/Observer*, I want to watch the negotiation happen live and then see the final Notion record, so that I can evaluate both the autonomy and the traceability of the system.

---

## 8. Success Criteria (Demo Acceptance)

1. At least one hiring request is resolved **entirely autonomously** by the two agents (no human input) — demonstrates agent coordination.
2. At least one hiring request is **escalated**, reviewed, and resolved by a human in Notion — demonstrates human-in-the-loop.
3. Both requests produce a **complete, legible record** in Notion showing the full reasoning chain.
4. The live activity feed shows agent negotiation happening in real time during the demo.
5. No raw/unformatted model output appears in the Notion record.

---

## 9. Assumptions & Constraints

- Notion API rate limit (~3 req/sec) means agent-to-agent chatter must stay outside Notion; only final outcomes and status changes are written there.
- Individual integration tokens should be scoped per agent, sharing only relevant pages, per the hackathon's access-control guidance.
- The demo is single-tenant and single-session; no concurrent multi-user conflict handling is required.

---

## 10. Open Questions

- Should the "counter-justification" step (FR-6) be limited to one round only, or should it be configurable?
- Should escalation thresholds (e.g., % over budget) be hardcoded or stored as policy in Notion for easy tuning during the demo?
- Is the HR Agent stretch goal in scope for the submission deadline, or reserved as a "future work" talking point?
