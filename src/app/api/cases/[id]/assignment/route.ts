import { NextResponse } from "next/server";
import { initDb } from "@/lib/db";
import { getActor } from "@/lib/auth";
import { assignCase } from "@/lib/workflow";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await initDb();
    const actor = await getActor(request);
    const { id } = await context.params;
    const body = await request.json();
    const record = await assignCase(id, String(body.assigneeId || ""), actor);
    return NextResponse.json({ case: record }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}

