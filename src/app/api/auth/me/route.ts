import { NextResponse } from "next/server";
import { initDb } from "@/lib/db";
import { getActor } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await initDb();
    const actor = await getActor(request);
    return NextResponse.json({ actor }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ actor: null, error: "Database connection is not ready." }, { status: 503 });
  }
}

