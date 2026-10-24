import { NextResponse } from "next/server";
import { initDb } from "@/lib/db";
import { getActor } from "@/lib/auth";
import { transitionCase } from "@/lib/workflow";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await initDb();
    const actor = await getActor(request);
    const { id } = await context.params;
    const body = await request.json();
    const record = await transitionCase(id, String(body.toState || ""), actor);
    return NextResponse.json({ case: record }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}

