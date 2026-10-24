import { NextResponse } from "next/server";
import { processEscalations } from "@/lib/workflow";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (process.env.NODE_ENV === "production" && !secret) {
    return NextResponse.json({ error: "CRON_SECRET is required." }, { status: 503 });
  }
  if (secret && request.headers.get("authorization") !== "Bearer " + secret) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }
  try {
    const escalated = await processEscalations();
    return NextResponse.json({ ok: true, escalated });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "The escalation run could not complete." }, { status: 503 });
  }
}

