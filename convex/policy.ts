import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

export const upsertPolicy = internalMutation({
  args: { key: v.string(), value: v.string() },
  handler: async (ctx, { key, value }) => {
    const existing = await ctx.db
      .query("policyCache")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { value, syncedAt: Date.now() });
    } else {
      await ctx.db.insert("policyCache", { key, value, syncedAt: Date.now() });
    }
  },
});



export const getAllPolicy = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("policyCache").collect();
  },
});
