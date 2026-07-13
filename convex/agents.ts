"use node";

import { internalAction, action } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import Groq from "groq-sdk";
import { sleep, NEGOTIATION_PACING_MS } from "./lib/pacing";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function callAgent(systemPrompt: string, userPrompt: string): Promise<string> {
  const completion = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    max_tokens: 400,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });
  return completion.choices[0]?.message?.content ?? "";
}

// ---------- Eng Manager Agent ----------

export const runEngManagerAgent = internalAction({
  args: { requestId: v.string(), isCounter: v.optional(v.boolean()) },
  handler: async (ctx, { requestId, isCounter }) => {
    const req = await ctx.runQuery(internal.hiringRequests.getRequestInternal, {
      requestId,
    });
    if (!req) throw new Error(`Unknown request: ${requestId}`);

    const systemPrompt = `You are the Engineering Manager Agent in a hiring workflow.
Speak in 2-3 short sentences, plain and direct — like a real manager, not a chatbot.
${isCounter ? "Finance has pushed back. Give ONE concise counter-justification." : "State the hiring request and why it matters."}`;

    const userPrompt = `Role: ${req.role} (${req.level})
Requested salary: $${req.salaryRequested}
Justification: ${req.justification}`;

    const message = await callAgent(systemPrompt, userPrompt);

    await ctx.runMutation(internal.hiringRequests.logAgentEvent, {
      requestId,
      agent: "eng_manager",
      message,
    });
  },
});

// ---------- Finance Agent ----------

export const runFinanceAgent = internalAction({
  args: { requestId: v.string(), isFinal: v.optional(v.boolean()) },
  handler: async (ctx, { requestId, isFinal }) => {
    const req = await ctx.runQuery(internal.hiringRequests.getRequestInternal, {
      requestId,
    });
    if (!req) throw new Error(`Unknown request: ${requestId}`);

    const policyRows = await ctx.runQuery(internal.policy.getAllPolicy, {});
    const policyText = policyRows.map((p: any) => `${p.key}: ${p.value}`).join("\n");

    const systemPrompt = `You are the Finance Agent in a hiring workflow. You are decisive and practical — you do not escalate things a competent finance manager would just approve.

Evaluate the request against company policy below. Respond in this exact format:
DECISION: <Auto-Approve | Auto-Reject | Escalate>
REASON: <one short, clear sentence>

Company policy:
${policyText}

Decision rules, in order:
1. Auto-Approve if the requested salary is less than 50% of the remaining budget cap AND the justification is clear and specific — this applies at ANY level including Staff/Executive. A senior title alone is not a reason to escalate; a well-justified, clearly-affordable hire should be approved regardless of seniority.
2. Auto-Reject only if the request is clearly and unambiguously impossible under policy (e.g. salary alone exceeds the entire remaining cap, or headcount is already at the limit) with no reasonable justification given.
3. Escalate ONLY if: the salary is a large fraction (over ~70%) of the remaining budget cap, OR the justification is vague/weak/missing, OR there's a genuine judgment call a human should make (e.g. conflicting priorities, unclear business need). Do not escalate purely because of seniority/title if the cost is low and the justification is solid.
${isFinal ? "This is the final round — you must Auto-Approve, Auto-Reject, or Escalate now, no more back-and-forth." : ""}`;
    const userPrompt = `Role: ${req.role} (${req.level})
Requested salary: $${req.salaryRequested}
Justification: ${req.justification}`;

    const raw = await callAgent(systemPrompt, userPrompt);

    const decisionMatch = raw.match(/DECISION:\s*(.+)/i);
    const reasonMatch = raw.match(/REASON:\s*(.+)/i);
    const decision = decisionMatch?.[1]?.trim() ?? "Escalate";
    const reason = reasonMatch?.[1]?.trim() ?? raw.trim();

    await ctx.runMutation(internal.hiringRequests.logAgentEvent, {
      requestId,
      agent: "finance",
      message: `${decision} — ${reason}`,
    });

    if (decision.toLowerCase().includes("approve") || decision.toLowerCase().includes("reject")) {
      await ctx.runMutation(internal.hiringRequests.updateStatus, {
        requestId,
        status: "resolved",
        financeDecision: decision.toLowerCase().includes("approve")
          ? "Auto-Approved"
          : "Auto-Rejected",
        financeReasoning: reason,
      });
      await ctx.runMutation(internal.hiringRequests.finalizeAutoDecision, {
        requestId,
        outcome: decision.toLowerCase().includes("approve") ? "Hired" : "Not Hired",
      });
    } else if (isFinal) {
      // Final round still ambiguous — force escalation rather than looping forever
      await ctx.runMutation(internal.hiringRequests.updateStatus, {
        requestId,
        status: "awaiting_human",
        financeDecision: "Escalated",
        financeReasoning: reason,
      });
    } else {
      await ctx.runMutation(internal.hiringRequests.updateStatus, {
        requestId,
        status: "negotiating",
        financeDecision: "Escalated",
        financeReasoning: reason,
      });
    }
  },
});

// ---------- Orchestrator ----------
// Drives the full negotiation with paced delays so judges can read
// each turn as it lands on the live activity feed.

export const runNegotiation = action({
  args: { requestId: v.string() },
  handler: async (ctx, { requestId }) => {
    await ctx.runAction(internal.agents.runEngManagerAgent, { requestId });
    await sleep(NEGOTIATION_PACING_MS);

    await ctx.runAction(internal.agents.runFinanceAgent, { requestId });
    await sleep(NEGOTIATION_PACING_MS);

    const req = await ctx.runQuery(internal.hiringRequests.getRequestInternal, {
      requestId,
    });

    if (req?.status === "negotiating") {
      await ctx.runAction(internal.agents.runEngManagerAgent, {
        requestId,
        isCounter: true,
      });
      await sleep(NEGOTIATION_PACING_MS);

      await ctx.runAction(internal.agents.runFinanceAgent, {
        requestId,
        isFinal: true,
      });
      await sleep(NEGOTIATION_PACING_MS);
    }

    await ctx.runAction(internal.notion.syncToNotion, { requestId });
  },
});

// ---------- Human decision resolution ----------

export const resolveHumanDecision = action({
  args: { requestId: v.string(), decision: v.string(), notes: v.string() },
  handler: async (ctx, args) => {
    const result = await ctx.runMutation(
      internal.hiringRequests.finalizeHumanDecision,
      args
    );

    if (result.ignored) {
      return { ignored: true };
    }

    await ctx.runAction(internal.notion.syncToNotion, {
      requestId: args.requestId,
    });
    return { ignored: false };
  },
});
