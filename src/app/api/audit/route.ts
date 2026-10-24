import { NextResponse } from "next/server";
import { initDb } from "@/lib/db";
import { getActor } from "@/lib/auth";
import { listAudit } from "@/lib/workflow";
import { unauthorized } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await initDb();
    const actor = await getActor(request);
    if (!actor) return unauthorized();
    return NextResponse.json({ events: await listAudit(actor) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "The audit history could not be loaded." }, { status: 503 });
  }
}

