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
  })
    .index("by_status", ["status"])
    .index("by_requestId", ["requestId"]),

  agentEvents: defineTable({
    requestId: v.string(),
    agent: v.string(), // "eng_manager" | "finance" | "system"
    message: v.string(),
    createdAt: v.number(),
  }).index("by_request", ["requestId"]),

  policyCache: defineTable({
    key: v.string(),
    value: v.string(),
    syncedAt: v.number(),
  }).index("by_key", ["key"]),
});
