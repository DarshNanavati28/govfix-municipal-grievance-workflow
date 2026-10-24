import { NextResponse } from "next/server";
import { initDb } from "@/lib/db";
import { getActor } from "@/lib/auth";
import { createCase, listCases, listOfficers, processEscalations } from "@/lib/workflow";
import { jsonError, unauthorized } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await initDb();
    const actor = await getActor(request);
    if (!actor) return unauthorized();
    await processEscalations();
    const [records, officers] = await Promise.all([listCases(actor), listOfficers()]);
    return NextResponse.json({ cases: records, officers, actor }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    await initDb();
    const actor = await getActor(request);
    const input = await request.json();
    const record = await createCase({
      title: String(input.title || ""),
      description: String(input.description || ""),
      category: String(input.category || ""),
      priority: String(input.priority || ""),
      ward: String(input.ward || ""),
      location: String(input.location || ""),
    }, actor);
    return NextResponse.json({ case: record }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}

