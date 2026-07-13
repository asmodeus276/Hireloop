import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

// ---------- Queries ----------

export const getRequest = query({
  args: { requestId: v.string() },
  handler: async (ctx, { requestId }) => {
    return await ctx.db
      .query("hiringRequests")
      .withIndex("by_requestId", (q) => q.eq("requestId", requestId))
      .unique();
  },
});

// Internal version so actions can call it without exposing it publicly
export const getRequestInternal = internalQuery({
  args: { requestId: v.string() },
  handler: async (ctx, { requestId }) => {
    return await ctx.db
      .query("hiringRequests")
      .withIndex("by_requestId", (q) => q.eq("requestId", requestId))
      .unique();
  },
});

export const listActiveRequests = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("hiringRequests").order("desc").take(50);
  },
});

export const getAgentEvents = query({
  args: { requestId: v.string() },
  handler: async (ctx, { requestId }) => {
    return await ctx.db
      .query("agentEvents")
      .withIndex("by_request", (q) => q.eq("requestId", requestId))
      .order("asc")
      .collect();
  },
});

export const getAgentEventsInternal = internalQuery({
  args: { requestId: v.string() },
  handler: async (ctx, { requestId }) => {
    return await ctx.db
      .query("agentEvents")
      .withIndex("by_request", (q) => q.eq("requestId", requestId))
      .order("asc")
      .collect();
  },
});

export const setNotionPageId = internalMutation({
  args: { requestId: v.string(), notionPageId: v.string() },
  handler: async (ctx, { requestId, notionPageId }) => {
    const req = await ctx.db
      .query("hiringRequests")
      .withIndex("by_requestId", (q) => q.eq("requestId", requestId))
      .unique();
    if (!req) throw new Error(`Unknown request: ${requestId}`);
    await ctx.db.patch(req._id, { notionPageId });
  },
});
export const listAwaitingHumanInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("hiringRequests")
      .withIndex("by_status", (q) => q.eq("status", "awaiting_human"))
      .collect();
  },
});
// ---------- Mutations ----------

export const createRequest = mutation({
  args: {
    role: v.string(),
    level: v.string(),
    salaryRequested: v.number(),
    justification: v.string(),
  },
  handler: async (ctx, args) => {
    const requestId = `REQ-${Date.now().toString(36).toUpperCase()}`;
    await ctx.db.insert("hiringRequests", {
      requestId,
      ...args,
      status: "drafting",
      createdAt: Date.now(),
    });
    return requestId;
  },
});

export const logAgentEvent = internalMutation({
  args: {
    requestId: v.string(),
    agent: v.string(),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("agentEvents", { ...args, createdAt: Date.now() });
  },
});

export const updateStatus = internalMutation({
  args: {
    requestId: v.string(),
    status: v.union(
      v.literal("drafting"),
      v.literal("negotiating"),
      v.literal("auto_resolved"),
      v.literal("awaiting_human"),
      v.literal("resolved")
    ),
    financeDecision: v.optional(v.string()),
    financeReasoning: v.optional(v.string()),
  },
  handler: async (ctx, { requestId, ...patch }) => {
    const req = await ctx.db
      .query("hiringRequests")
      .withIndex("by_requestId", (q) => q.eq("requestId", requestId))
      .unique();
    if (!req) throw new Error(`Unknown request: ${requestId}`);
    await ctx.db.patch(req._id, patch);
  },
});

export const finalizeAutoDecision = internalMutation({
  args: { requestId: v.string(), outcome: v.string() },
  handler: async (ctx, { requestId, outcome }) => {
    const req = await ctx.db
      .query("hiringRequests")
      .withIndex("by_requestId", (q) => q.eq("requestId", requestId))
      .unique();
    if (!req) throw new Error(`Unknown request: ${requestId}`);
    await ctx.db.patch(req._id, { finalOutcome: outcome });
  },
});

// The ONLY place a request is allowed to leave "awaiting_human".
// Atomic check-and-set inside one mutation makes duplicate webhook
// calls / late polls safe no-ops instead of double-writes.
export const finalizeHumanDecision = internalMutation({
  args: {
    requestId: v.string(),
    decision: v.string(), // "Approved" | "Rejected" | "Overridden"
    notes: v.string(),
  },
  handler: async (ctx, { requestId, decision, notes }) => {
    const req = await ctx.db
      .query("hiringRequests")
      .withIndex("by_requestId", (q) => q.eq("requestId", requestId))
      .unique();
    if (!req) throw new Error(`Unknown request: ${requestId}`);

    if (req.status !== "awaiting_human") {
      await ctx.db.insert("agentEvents", {
        requestId,
        agent: "system",
        message: `Ignored duplicate decision webhook (status already "${req.status}")`,
        createdAt: Date.now(),
      });
      return { ignored: true, currentStatus: req.status };
    }

    await ctx.db.patch(req._id, {
      status: "resolved",
      finalOutcome: decision === "Approved" ? "Hired" : "Not Hired",
    });

    await ctx.db.insert("agentEvents", {
      requestId,
      agent: "system",
      message: `Human decision recorded: ${decision}${notes ? ` — ${notes}` : ""}`,
      createdAt: Date.now(),
    });

    return { ignored: false };
  },
});
