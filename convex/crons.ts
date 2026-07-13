import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Checks Notion for status changes on any request awaiting human
// review, roughly every 15 seconds. Only touches Notion for requests
// that are actually pending, so this is well within the rate limit
// even at this frequency.
crons.interval(
  "poll notion for human decisions",
  { seconds: 15 },
  internal.notion.pollNotionForDecisions,
  {}
);

export default crons;