# HireLoop — Setup Guide (Starting From Zero)

This gets you from an empty machine to a running demo. Budget ~1–1.5 hours the first time through.

## 0. Prerequisites
- Node.js 18+ installed
- A free [Convex](https://convex.dev) account
- A free [Notion](https://notion.so) account
- An [Anthropic API key](https://console.anthropic.com) (or swap `agents.ts` to use Gemini/OpenAI if you prefer)

## 1. Install dependencies
```bash
cd hireloop
npm install
```

## 2. Set up Convex
```bash
npx convex dev
```
This will open a browser to log in / create a Convex project, then start syncing your `convex/` folder and give you a deployment URL. **Leave this running** in a terminal tab — it live-reloads your backend as you edit.

Copy the deployment URL it prints (looks like `https://your-project.convex.cloud`) into a `.env.local` file:
```
VITE_CONVEX_URL=https://your-project.convex.cloud
```

## 3. Set up Notion

### 3a. Create the integration(s)
Go to [notion.so/my-integrations](https://www.notion.so/my-integrations) → **New integration**.
For the demo, one integration token is fine to start; the TRD calls for per-agent tokens as a security best practice once you have time.

Copy the token (starts with `secret_` or `ntn_`).

### 3b. Create the databases
In Notion, create two databases matching the TRD schema:

**"Hiring Decisions"** — properties:
- Request ID (Title)
- Role (Text)
- Level (Select: Junior/Mid/Senior/Staff)
- Salary Requested (Number)
- Urgency/Justification (Text)
- Finance Decision (Select: Auto-Approved/Auto-Rejected/Escalated)
- Finance Reasoning (Text)
- Status (Select: Pending/Awaiting Human Review/Approved/Rejected/Overridden)
- Final Outcome (Select: Hired/Not Hired)
- Full Reasoning Log (Text)

**"Company Policy"** — properties:
- Policy Key (Title)
- Value (Number)

Add a row like `Q3 Eng Budget Cap` / `450000` to Company Policy so Finance Agent has something real to evaluate against.

### 3c. Share the databases with your integration
Open each database → `•••` menu → **Connections** → add your integration.

### 3d. Get the database IDs
The ID is the 32-character string in the database URL:
`https://notion.so/yourworkspace/`**`a1b2c3d4e5f6...`**`?v=...`

## 4. Set Convex environment variables
```bash
npx convex env set ANTHROPIC_API_KEY sk-ant-...
npx convex env set NOTION_TOKEN secret_...
npx convex env set NOTION_HIRING_DB_ID a1b2c3d4...
npx convex env set NOTION_POLICY_DB_ID e5f6a7b8...
```

## 5. Seed policy into Convex
The Finance Agent reads from `policyCache`, which is populated by `syncPolicyFromNotion`. Run it once from the Convex dashboard (Functions tab → find `notion:syncPolicyFromNotion` → Run), or call it from a script.

## 6. Run the frontend
In a second terminal:
```bash
npm run dev
```
Open the printed local URL. Submit a hiring request and watch the activity feed populate live.

## 7. Human-in-the-loop: webhook vs polling
Notion's native webhook/automation support varies by plan — verify what's available to you. Two options:

**Option A — Notion webhook (if available on your plan):**
Point it at:
```
https://your-project.convex.site/notion-webhook
```
with a JSON body shaped like `{ "requestId": "...", "newStatus": "Approved", "humanNotes": "..." }`. You'll likely need a small piece of glue (a Notion automation or a lightweight script) to translate Notion's native webhook payload into this shape.

**Option B — Polling fallback (simpler to get working fast):**
Add a Convex [cron job](https://docs.convex.dev/scheduling/cron-jobs) that runs every 15–20 seconds, queries Notion for pages with Status in (Approved/Rejected/Overridden) that haven't been processed yet, and calls `resolveHumanDecision` for each. This is well within the ~3 req/sec rate limit and is the faster path to a working demo — recommended if you're short on time.

## 8. Rehearse
Run through **two full requests** before presenting:
1. One that should clearly resolve automatically (well within budget)
2. One that should escalate (over budget or ambiguous) — go into Notion, flip the Status property yourself, and confirm the workflow resumes

## Project structure
```
convex/
  schema.ts          — database tables
  hiringRequests.ts   — mutations/queries, idempotent decision handler
  policy.ts           — policy cache
  agents.ts            — Eng Manager + Finance agent logic, orchestration, pacing
  notion.ts            — Notion read/write (policy sync, record sync)
  http.ts              — webhook route
  lib/pacing.ts        — sleep() utility + pacing constant
src/
  App.tsx              — live demo frontend
  main.tsx             — Convex provider setup
```
