import { NextResponse } from "next/server";
import { initDb, client } from "@/lib/db";
import { getActor } from "@/lib/auth";
import { getCase, type AuditEvent } from "@/lib/workflow";
import { jsonError, unauthorized } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await initDb();
    const actor = await getActor(request);
    if (!actor) return unauthorized();
    const { id } = await context.params;
    const record = await getCase(id, actor);
    if (!record) return NextResponse.json({ error: "This request could not be found." }, { status: 404 });
    const result = await client.execute({ sql: "SELECT * FROM audit_events WHERE case_id=? ORDER BY occurred_at ASC", args: [id] });
    const events = result.rows.map((row) => {
      const e = row as unknown as Record<string, unknown>;
      return { id: String(e.id), caseId: e.case_id ? String(e.case_id) : null, eventType: String(e.event_type), actorId: e.actor_id ? String(e.actor_id) : null, actorName: String(e.actor_name), actorRole: String(e.actor_role), fromValue: e.from_value ? String(e.from_value) : null, toValue: e.to_value ? String(e.to_value) : null, accepted: Boolean(e.accepted), occurredAt: String(e.occurred_at), note: String(e.note) } satisfies AuditEvent;
    });
    return NextResponse.json({ case: record, events }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}

