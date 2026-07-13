# Technical Requirements Document (TRD)
## HireLoop — Autonomous Hiring & Budget Approval System

**Project Track:** Cross-Track (Notion + Convex)
**Version:** 1.0
**Date:** July 12, 2026
**Companion document:** HireLoop_FRD.md

---

## 1. System Overview

HireLoop splits state across two layers, per the hackathon architecture guidance:

- **Convex** — short-lived runtime state: agent activity, in-progress negotiation, orchestration logic, webhook handling.
- **Notion** — durable organizational state: company policy, final decisions, human approvals, historical records.

```
┌─────────────────────┐        ┌──────────────────────┐
│   Convex Backend     │        │        Notion         │
│  (runtime + agents)  │◄──────►│  (durable org state)  │
│                       │  API/  │                        │
│  - Agent orchestration│  MCP  │  - Hiring Decisions DB │
│  - Reactive queries   │        │  - Company Policy DB  │
│  - HTTP webhook route │◄───────│  - Human approvals via │
│                       │Webhook │    status field edits  │
└──────────┬────────────┘        └──────────────────────┘
           │
           ▼
   ┌───────────────┐
   │  Live Demo UI  │
   │ (React, reactive
   │  Convex queries)│
   └───────────────┘
```

---

## 2. Technology Stack

| Layer | Technology | Notes |
|---|---|---|
| Backend / orchestration | **Convex** | Functions, actions, reactive queries, HTTP router for webhooks |
| Durable record store | **Notion** (API + MCP) | Two databases: Hiring Decisions, Company Policy |
| Agent reasoning | LLM API (Claude or Gemini) called from Convex actions | Model-agnostic; choose based on team familiarity |
| Frontend | React + Convex client hooks | Live activity feed via `useQuery` reactivity |
| Hosting | Convex Cloud (backend) + Vercel/Netlify or Convex-hosted (frontend) | |
| Auth/tokens | Per-agent Notion integration tokens | Scoped access per department page, per hackathon access-control guidance |

---

## 3. Data Model

### 3.1 Convex Schema (`convex/schema.ts`)

```ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  hiringRequests: defineTable({
    requestId: v.string(),
    role: v.string(),
    level: v.string(),
    salaryRequested: v.number(),
    justification: v.string(),
    status: v.union(
      v.literal("drafting"),
      v.literal("negotiating"),
      v.literal("auto_resolved"),
      v.literal("awaiting_human"),
      v.literal("resolved")
    ),
    financeDecision: v.optional(v.string()),
    financeReasoning: v.optional(v.string()),
    finalOutcome: v.optional(v.string()),
    notionPageId: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_status", ["status"])
    .index("by_requestId", ["requestId"]),

  agentEvents: defineTable({
    requestId: v.string(),
    agent: v.string(),        // "eng_manager" | "finance" | "system"
    message: v.string(),
    createdAt: v.number(),
  }).index("by_request", ["requestId"]),

  policyCache: defineTable({
    key: v.string(),          // e.g. "q3_eng_budget_cap"
    value: v.string(),
    syncedAt: v.number(),
  }).index("by_key", ["key"]),
});
```

### 3.2 Notion — "Hiring Decisions" Database

| Property | Type | Purpose |
|---|---|---|
| Request ID | Title | Join key with Convex `requestId` |
| Role | Text | |
| Level | Select | Junior / Mid / Senior / Staff |
| Salary Requested | Number | |
| Urgency/Justification | Text | Eng Manager Agent's reasoning |
| Budget Remaining (Q3) | Number | Synced from Company Policy DB |
| Finance Decision | Select | Auto-Approved / Auto-Rejected / Escalated |
| Finance Reasoning | Text | Short, formatted summary |
| Status | Select | Pending / Awaiting Human Review / Approved / Rejected / Overridden |
| Human Reviewer | Person | |
| Human Notes | Text | |
| Final Outcome | Select | Hired / Not Hired |
| Full Reasoning Log | Text (long) | Complete negotiation trace |
| Created / Last Edited | Auto timestamps | |

### 3.3 Notion — "Company Policy" Database

| Property | Type | Purpose |
|---|---|---|
| Policy Key | Title | e.g. "Q3 Eng Budget Cap" |
| Value | Number/Text | Current cap, headcount limit, etc. |
| Last Updated | Auto timestamp | |

---

## 4. Function / Action Inventory

### 4.1 Convex Queries (read, reactive)
| Function | Description |
|---|---|
| `getRequest(requestId)` | Current state of a single request |
| `listActiveRequests()` | All in-progress requests, for dashboard |
| `getAgentEvents(requestId)` | Live negotiation trace for the activity feed |

### 4.2 Convex Mutations (fast writes, no external calls)
| Function | Description |
|---|---|
| `createRequest({role, level, salaryRequested, justification})` | Initializes a new request in `drafting` status |
| `logAgentEvent({requestId, agent, message})` | Appends one negotiation event |
| `updateStatus({requestId, status})` | Transitions request state |

### 4.3 Convex Actions (can call LLM APIs and Notion)
| Function | Description |
|---|---|
| `runEngManagerAgent(requestId)` | Generates initial structured request via LLM call |
| `runFinanceAgent(requestId)` | Fetches policy (from `policyCache`, refreshed from Notion), evaluates, decides approve/reject/escalate |
| `syncPolicyFromNotion()` | Periodically refreshes `policyCache` from the Notion Company Policy DB |
| `syncToNotion(requestId)` | Writes/updates the Hiring Decisions page: request details, agent reasoning, status |
| `resolveHumanDecision({requestId, decision, notes})` | Triggered by webhook; resumes workflow, writes final outcome and closing log entry |

### 4.4 HTTP Router (`convex/http.ts`)
| Route | Method | Purpose |
|---|---|---|
| `/notion-webhook` | POST | Receives Notion status-change events; verifies payload; calls `resolveHumanDecision` |

```ts
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";

const http = httpRouter();

http.route({
  path: "/notion-webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const payload = await request.json();
    // TODO: validate signature/secret if Notion webhook supports it
    if (["Approved", "Rejected", "Overridden"].includes(payload.newStatus)) {
      await ctx.runAction(api.agents.resolveHumanDecision, {
        requestId: payload.requestId,
        decision: payload.newStatus,
        notes: payload.humanNotes ?? "",
      });
    }
    return new Response("ok", { status: 200 });
  }),
});

export default http;
```

> **Note:** Notion's native webhook/automation support should be verified against current Notion API docs at build time; if unavailable, a lightweight polling action (interval ~10–15s, well under the rate limit) is an acceptable fallback — explicitly allowed since it's a status check, not agent chatter.

---

## 5. Workflow Sequence (Technical)

1. `createRequest` mutation → row inserted, status `drafting`
2. `runEngManagerAgent` action → LLM call → structured request finalized → `logAgentEvent`
3. `syncPolicyFromNotion` (if cache stale) → refresh `policyCache`
4. `runFinanceAgent` action → LLM call using cached policy → decision:
   - **Auto-Approve/Reject** → `updateStatus("resolved")` → `syncToNotion`
   - **Borderline** → one counter-round via `runEngManagerAgent` → re-evaluate → resolve or escalate
   - **Escalate** → `updateStatus("awaiting_human")` → `syncToNotion` (creates Notion page, sets Status = "Awaiting Human Review")
5. Human edits Status property in Notion → webhook fires → `/notion-webhook` → `resolveHumanDecision`
6. `resolveHumanDecision` → `updateStatus("resolved")` → final `syncToNotion` write with closing log
7. Frontend `useQuery(getAgentEvents)` and `useQuery(getRequest)` update live throughout — no manual refresh needed

---

## 6. Implementation Notes: Idempotency & Demo Pacing

### 6.1 Idempotency Protection
Duplicate webhook deliveries or overlapping poll updates must not corrupt the log or double-resolve a request.

- The transition **out of `awaiting_human`** happens inside a single internal mutation (`finalizeHumanDecision`) that first checks `status === "awaiting_human"` before patching. Convex mutations are transactional, so this check-and-set is atomic — a second, duplicate call sees the already-updated status and safely no-ops instead of overwriting `finalOutcome` or duplicating the closing log entry.
- The `resolveHumanDecision` action calls this mutation first, then only proceeds to `syncToNotion` if the mutation reports the update was applied (`ignored: false`).
- Duplicate/ignored calls still write a lightweight `system` event to `agentEvents` for debugging visibility, but never touch `hiringRequests.status` or `finalOutcome` a second time.

### 6.2 Artificial Delays for Demo Pacing
LLM agent turns can resolve in ~1–2 seconds combined, which reads as a single flash of text on the live activity feed rather than a followable negotiation.

- A `sleep(ms)` utility (`setTimeout`-based) is inserted **between agent turns inside the orchestrating action** (`runNegotiation`), not inside mutations or the LLM calls themselves — pacing is a presentation concern, not a data concern.
- Suggested pacing: ~2,000–2,500ms between each agent turn, tuned during rehearsal so judges can read each message before the next lands.
- Pacing constant should be a named, easily adjustable value (e.g., `NEGOTIATION_PACING_MS`) so it can be set to `0` for automated tests and restored for the live demo.
- Because each agent turn writes to `agentEvents` via mutation immediately before its `sleep`, the frontend's reactive query updates the instant the message is written — the delay only controls the gap before the *next* message, not the responsiveness of the UI.

## 7. Non-Functional Requirements

| Category | Requirement |
|---|---|
| **Rate limiting** | All agent-to-agent messages stay in Convex (`agentEvents` table). Notion is only touched by `syncPolicyFromNotion`, `syncToNotion`, and the webhook — well under ~3 req/sec |
| **Security** | Separate Notion integration token per agent; each token shares only its relevant department pages |
| **Formatting** | `syncToNotion` must transform raw LLM output into short, structured summaries before writing — never dump raw model text |
| **Latency** | Live activity feed should reflect new `agentEvents` within ~1s (native Convex reactivity handles this) |
| **Reliability** | Webhook handler must be idempotent — re-processing the same status-change payload should not duplicate log entries |
| **Auditability** | Every Notion page must retain full reasoning history even after resolution (no overwriting past reasoning) |

---

## 8. Deployment Plan

1. `npx create convex` → scaffold project
2. Define schema, deploy with `npx convex dev`
3. Create Notion integration(s), scope tokens per agent, share relevant pages/databases
4. Build Hiring Decisions + Company Policy databases in Notion per schema in Section 3
5. Implement actions incrementally: mutations → queries → LLM actions → Notion sync → webhook
6. Build minimal React frontend using Convex hooks for the live activity view
7. Deploy backend via Convex Cloud; deploy frontend via Vercel/Netlify or Convex hosting
8. End-to-end test: one auto-resolved request, one escalated + human-resolved request

---

## 9. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Notion webhook support is limited/unavailable at build time | Fall back to low-frequency polling action (well within rate limits) |
| LLM produces unformatted or verbose output for Notion | Add a dedicated "formatting" step/prompt before `syncToNotion` writes |
| Demo timing — negotiation resolves too fast to show live value | Addressed via the paced `sleep()` calls between agent turns (see Section 6.2) |
| Duplicate human decision (double-click, retry, late poll) corrupts final record | Addressed via atomic status-check mutation before any write (see Section 6.1) |
| Scope creep into 3rd/4th agent | Explicitly cap at 2 core agents + optional HR agent stretch goal only if time remains |

---

## 10. Open Technical Decisions

- LLM provider for agent reasoning (Claude vs Gemini) — pick based on team's existing API access
- Webhook vs polling for Notion status changes — confirm Notion's current webhook capability before committing
- Whether `policyCache` refreshes on a timer or on-demand per request
