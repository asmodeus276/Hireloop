"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal, api } from "./_generated/api";
import { Client } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const HIRING_DATA_SOURCE_ID = process.env.NOTION_HIRING_DATA_SOURCE_ID!;
const POLICY_DATA_SOURCE_ID = process.env.NOTION_POLICY_DATA_SOURCE_ID!;

// Pulls current policy values into the Convex cache so Finance Agent
// doesn't hit Notion on every single evaluation (stays well under
// the ~3 req/sec API limit).
export const syncPolicyFromNotion = internalAction({
  args: {},
  handler: async (ctx) => {
    const response = await notion.dataSources.query({
      data_source_id: POLICY_DATA_SOURCE_ID,
    });

    for (const page of response.results as any[]) {
      // Match property keys by trimmed name, in case Notion has
      // hidden leading/trailing whitespace on the property name.
      const props = page.properties as Record<string, any>;
      const keyEntry = Object.entries(props).find(([k]) => k.trim() === "Policy Key");
      const valueEntry = Object.entries(props).find(([k]) => k.trim() === "Value");

      const key = keyEntry?.[1]?.title?.[0]?.plain_text ?? "";
      const value =
        valueEntry?.[1]?.number?.toString() ??
        valueEntry?.[1]?.rich_text?.[0]?.plain_text ??
        "";

      if (key) {
        await ctx.runMutation(internal.policy.upsertPolicy, { key, value });
      }
    }
  },
});

// Polls Notion for status changes on requests currently awaiting human
// review. Runs on a timer (see crons.ts) rather than via webhook, since
// Notion webhook/automation availability varies by plan. Only checks
// requests that are actually pending, so this stays far under the
// ~3 req/sec API limit even with frequent polling.
export const pollNotionForDecisions = internalAction({
  args: {},
  handler: async (ctx) => {
    const pending = await ctx.runQuery(internal.hiringRequests.listAwaitingHumanInternal, {});

    for (const req of pending) {
      if (!req.notionPageId) continue;

      const page: any = await notion.pages.retrieve({ page_id: req.notionPageId });
      const props: Record<string, any> = page.properties ?? {};
      const statusEntry = Object.entries(props).find(([k]) => k.trim() === "Status");
      const statusValue: string | undefined = statusEntry?.[1]?.select?.name;

      if (statusValue && ["Approved", "Rejected", "Overridden"].includes(statusValue)) {
        await ctx.runAction(api.agents.resolveHumanDecision, {
          requestId: req.requestId,
          decision: statusValue,
          notes: "",
        });
      }
    }
  },
});


// Notion property names can pick up invisible leading/trailing
// whitespace when renamed through the UI, and property types can
// end up different than expected too. Rather than fight that by
// hand, we fetch the real schema once and adapt to it.
async function getSchema(dataSourceId: string): Promise<Record<string, { realName: string; type: string }>> {
  const ds: any = await notion.dataSources.retrieve({ data_source_id: dataSourceId });
  const realProps: Record<string, any> = ds.properties ?? {};
  const map: Record<string, { realName: string; type: string }> = {};
  for (const [realName, def] of Object.entries(realProps)) {
    map[realName.trim()] = { realName, type: (def as any).type };
  }
  return map;
}

// Builds a Notion property value in whatever type that property
// actually is, given a plain "logical" value (string, number, etc).
function buildPropertyValue(type: string, rawValue: any): any {
  switch (type) {
    case "title":
      return { title: [{ text: { content: String(rawValue) } }] };
    case "rich_text":
      return { rich_text: [{ text: { content: String(rawValue).slice(0, 1900) } }] };
    case "number":
      return { number: Number(rawValue) };
    case "select":
      return { select: { name: String(rawValue) } };
    case "url":
      return { url: String(rawValue) };
    default:
      // Fallback: try rich_text, the safest general-purpose type
      return { rich_text: [{ text: { content: String(rawValue).slice(0, 1900) } }] };
  }
}

// Always writes short, formatted summaries — never raw model dumps.
export const syncToNotion = internalAction({
  args: { requestId: v.string() },
  handler: async (ctx, { requestId }) => {
    const req = await ctx.runQuery(internal.hiringRequests.getRequestInternal, {
      requestId,
    });
    if (!req) throw new Error(`Unknown request: ${requestId}`);

    const events = await ctx.runQuery(internal.hiringRequests.getAgentEventsInternal, {
      requestId,
    });

    const reasoningLog = events
      .map((e: any) => `[${e.agent}] ${e.message}`)
      .join("\n\n");

    const statusMap: Record<string, string> = {
      drafting: "Pending",
      negotiating: "Pending",
      auto_resolved: "Approved",
      awaiting_human: "Awaiting Human Review",
      resolved: req.finalOutcome === "Hired" ? "Approved" : "Rejected",
    };

    // Plain logical values first — no Notion-specific formatting yet.
    const rawValues: Record<string, any> = {
      "Request ID": req.requestId,
      Role: req.role,
      Level: req.level,
      "Salary Requested": req.salaryRequested,
      "Urgency/Justification": req.justification,
      "Finance Decision": req.financeDecision,
      "Finance Reasoning": req.financeReasoning,
      Status: statusMap[req.status] ?? "Pending",
      "Final Outcome": req.finalOutcome,
      "Full Reasoning Log": reasoningLog,
    };
    Object.keys(rawValues).forEach(
      (k) => (rawValues[k] === undefined || rawValues[k] === null) && delete rawValues[k]
    );

    // Match each logical field to Notion's real name + real type,
    // then format the value accordingly (Number vs Text vs Select, etc).
    const schema = await getSchema(HIRING_DATA_SOURCE_ID);
    const properties: Record<string, any> = {};
    for (const [logicalName, value] of Object.entries(rawValues)) {
      const entry = schema[logicalName.trim()];
      if (!entry) continue; // property doesn't exist in Notion — skip rather than fail
      properties[entry.realName] = buildPropertyValue(entry.type, value);
    }

    if (req.notionPageId) {
      await notion.pages.update({ page_id: req.notionPageId, properties });
    } else {
      const page = await notion.pages.create({
        parent: { type: "data_source_id", data_source_id: HIRING_DATA_SOURCE_ID },
        properties,
      });
      await ctx.runMutation(internal.hiringRequests.setNotionPageId, {
        requestId,
        notionPageId: page.id,
      });
    }
  },
});