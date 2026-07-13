import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";

const http = httpRouter();

// Notion sends a POST here when a hiring request's Status property
// changes to Approved / Rejected / Overridden. If your Notion plan
// doesn't support native webhooks, use a scheduled polling action
// instead (see README) — the resolveHumanDecision logic is idempotent
// either way, so both approaches are safe.
http.route({
  path: "/notion-webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const payload = await request.json();

    const newStatus = payload.newStatus as string | undefined;
    const requestId = payload.requestId as string | undefined;

    if (!requestId || !newStatus) {
      return new Response("Missing requestId or newStatus", { status: 400 });
    }

    if (["Approved", "Rejected", "Overridden"].includes(newStatus)) {
      await ctx.runAction(api.agents.resolveHumanDecision, {
        requestId,
        decision: newStatus,
        notes: payload.humanNotes ?? "",
      });
    }

    return new Response("ok", { status: 200 });
  }),
});

export default http;
