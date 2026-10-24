import { randomUUID } from "node:crypto";
import { client, initDb, slaHours } from "./db";
import type { Actor, Role } from "./auth";

export const STATES: Record<string, string> = {
  RECEIVED: "Received",
  TRIAGED: "Triaged",
  IN_PROGRESS: "In progress",
  WAITING_FOR_CITIZEN: "Awaiting resident",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};

export interface CaseRecord {
  id: string;
  ref: string;
  title: string;
  description: string;
  category: string;
  priority: string;
  state: string;
  ward: string;
  location: string;
  citizenId: string;
  citizenName: string;
  assigneeId: string | null;
  assigneeName: string | null;
  dueAt: string;
  escalatedAt: string | null;
  escalationLevel: number;
  createdAt: string;
  updatedAt: string;
}

export interface AuditEvent {
  id: string;
  caseId: string | null;
  eventType: string;
  actorId: string | null;
  actorName: string;
  actorRole: string;
  fromValue: string | null;
  toValue: string | null;
  accepted: boolean;
  occurredAt: string;
  note: string;
  caseRef?: string | null;
  title?: string | null;
}

export class WorkflowError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function mapCase(row: Record<string, unknown>): CaseRecord {
  return {
    id: String(row.id), ref: String(row.case_ref), title: String(row.title), description: String(row.description),
    category: String(row.category), priority: String(row.priority), state: String(row.state), ward: String(row.ward),
    location: String(row.location), citizenId: String(row.citizen_id), citizenName: String(row.citizen_name || "Resident"),
    assigneeId: row.assignee_id ? String(row.assignee_id) : null, assigneeName: row.assignee_name ? String(row.assignee_name) : null,
    dueAt: String(row.due_at), escalatedAt: row.escalated_at ? String(row.escalated_at) : null,
    escalationLevel: Number(row.escalation_level), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

async function rawCase(id: string): Promise<CaseRecord | null> {
  const result = await client.execute({
    sql: "SELECT c.*, citizen.name AS citizen_name, assigned.name AS assignee_name FROM cases c LEFT JOIN users citizen ON citizen.id=c.citizen_id LEFT JOIN users assigned ON assigned.id=c.assignee_id WHERE c.id=?",
    args: [id],
  });
  const row = result.rows[0] as unknown as Record<string, unknown> | undefined;
  return row ? mapCase(row) : null;
}

export async function listCases(actor: Actor): Promise<CaseRecord[]> {
  const sql = actor.role === "citizen"
    ? "SELECT c.*, citizen.name AS citizen_name, assigned.name AS assignee_name FROM cases c LEFT JOIN users citizen ON citizen.id=c.citizen_id LEFT JOIN users assigned ON assigned.id=c.assignee_id WHERE c.citizen_id=? ORDER BY c.created_at DESC"
    : "SELECT c.*, citizen.name AS citizen_name, assigned.name AS assignee_name FROM cases c LEFT JOIN users citizen ON citizen.id=c.citizen_id LEFT JOIN users assigned ON assigned.id=c.assignee_id ORDER BY CASE WHEN c.state='CLOSED' THEN 1 ELSE 0 END, c.due_at ASC";
  const result = await client.execute({ sql, args: actor.role === "citizen" ? [actor.id] : [] });
  return result.rows.map((row) => mapCase(row as unknown as Record<string, unknown>));
}

export async function getCase(id: string, actor: Actor | null): Promise<CaseRecord | null> {
  const record = await rawCase(id);
  if (!record) return null;
  if (actor?.role === "citizen" && record.citizenId !== actor.id) return null;
  return record;
}

async function addEvent(event: Omit<AuditEvent, "id" | "occurredAt"> & { occurredAt?: string }) {
  await client.execute({
    sql: "INSERT INTO audit_events (id,case_id,event_type,actor_id,actor_name,actor_role,from_value,to_value,accepted,occurred_at,note) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    args: [randomUUID(), event.caseId, event.eventType, event.actorId, event.actorName, event.actorRole, event.fromValue, event.toValue, event.accepted ? 1 : 0, event.occurredAt || new Date().toISOString(), event.note],
  });
}

async function refuse(caseId: string | null, actor: Actor | null, kind: string, from: string | null, to: string | null, reason: string) {
  await addEvent({
    caseId, eventType: kind + "_refused", actorId: actor?.id || null, actorName: actor?.name || "Unauthenticated visitor",
    actorRole: actor?.role || "unknown", fromValue: from, toValue: to, accepted: false, note: reason,
  });
  throw new WorkflowError(reason, actor ? 403 : 401);
}

const officerMoves: Record<string, string[]> = {
  RECEIVED: ["TRIAGED"],
  TRIAGED: ["IN_PROGRESS"],
  IN_PROGRESS: ["WAITING_FOR_CITIZEN", "RESOLVED"],
};
const citizenMoves: Record<string, string[]> = {
  WAITING_FOR_CITIZEN: ["IN_PROGRESS"],
  RESOLVED: ["CLOSED", "IN_PROGRESS"],
};

export async function transitionCase(id: string, toState: string, actor: Actor | null): Promise<CaseRecord> {
  await initDb();
  const record = await rawCase(id);
  if (!record) throw new WorkflowError("This request could not be found.", 404);
  if (!actor) await refuse(id, actor, "transition", record.state, toState, "Sign in to make a status change.");
  const currentActor = actor as Actor;
  const isOwner = record.citizenId === currentActor.id;
  const roleMoves = currentActor.role === "citizen" ? citizenMoves : officerMoves;
  const mayMove = Boolean(roleMoves[record.state]?.includes(toState));
  if (currentActor.role === "citizen" && !isOwner) await refuse(id, currentActor, "transition", record.state, toState, "Residents can only update their own requests.");
  if (!mayMove) {
    const allowed = roleMoves[record.state]?.map((state) => STATES[state]).join(", ") || "no next step";
    await refuse(id, currentActor, "transition", record.state, toState, "You cannot move this request from " + STATES[record.state] + " to " + (STATES[toState] || toState) + ". The allowed next step is " + allowed + ".");
  }
  if (currentActor.role === "officer" && record.assigneeId && record.assigneeId !== currentActor.id) {
    await refuse(id, currentActor, "transition", record.state, toState, "This request is assigned to another officer. Ask a supervisor to reassign it.");
  }
  if (currentActor.role === "officer" && record.state === "RESOLVED") {
    await refuse(id, currentActor, "transition", record.state, toState, "Only the resident can confirm or reopen a resolved request.");
  }
  const now = new Date().toISOString();
  const reopened = record.state === "RESOLVED" && toState === "IN_PROGRESS";
  const dueAt = reopened ? new Date(Date.now() + slaHours(record.priority) * 3600000).toISOString() : record.dueAt;
  await client.execute({
    sql: "UPDATE cases SET state=?, due_at=?, updated_at=? WHERE id=? AND state=?",
    args: [toState, dueAt, now, id, record.state],
  });
  await addEvent({
    caseId: id, eventType: "transition", actorId: currentActor.id, actorName: currentActor.name, actorRole: currentActor.role,
    fromValue: record.state, toValue: toState, accepted: true,
    note: reopened ? "Resident reopened the request. A fresh response window began under the municipal review rule." : "Workflow step completed.",
    occurredAt: now,
  });
  if (reopened) {
    await addEvent({
      caseId: id, eventType: "deadline_reset", actorId: null, actorName: "Workflow rule", actorRole: "system",
      fromValue: record.dueAt, toValue: dueAt, accepted: true, note: "Reopened requests receive a fresh response window based on their original priority.",
      occurredAt: now,
    });
  }
  const updated = await rawCase(id);
  return updated as CaseRecord;
}

export async function createCase(input: {
  title: string; description: string; category: string; priority: string; ward: string; location: string;
}, actor: Actor | null): Promise<CaseRecord> {
  await initDb();
  if (!actor) await refuse(null, actor, "submission", null, "RECEIVED", "Sign in as a resident to submit a request.");
  const currentActor = actor as Actor;
  if (currentActor.role !== "citizen") await refuse(null, currentActor, "submission", null, "RECEIVED", "Only residents can submit requests.");
  const required: Array<[string, string]> = [["title", input.title], ["description", input.description], ["category", input.category], ["ward", input.ward], ["location", input.location]];
  const missing = required.find(([, value]) => !value?.trim());
  if (missing) await refuse(null, currentActor, "submission", null, "RECEIVED", "Please complete the " + missing[0] + " field.");
  if (input.title.length > 100 || input.description.length > 1200) await refuse(null, currentActor, "submission", null, "RECEIVED", "The title or description is longer than the allowed limit.");
  if (!["Critical", "High", "Standard", "Low"].includes(input.priority)) await refuse(null, currentActor, "submission", null, "RECEIVED", "Choose a valid service priority.");
  const caseId = randomUUID();
  const now = new Date();
  const dueAt = new Date(now.getTime() + slaHours(input.priority) * 3600000);
  const count = await client.execute("SELECT COUNT(*) AS count FROM cases");
  const ref = "GF-" + String(2401 + Number(count.rows[0]?.count || 0)).padStart(4, "0");
  await client.execute({
    sql: "INSERT INTO cases (id,case_ref,title,description,category,priority,state,ward,location,citizen_id,assignee_id,due_at,escalation_level,created_at,updated_at) VALUES (?,?,?,?,?,?,'RECEIVED',?,?,?,NULL,?,0,?,?)",
    args: [caseId,ref,input.title.trim(),input.description.trim(),input.category,input.priority,input.ward,input.location,currentActor.id,dueAt.toISOString(),now.toISOString(),now.toISOString()],
  });
  await addEvent({
    caseId, eventType: "submitted", actorId: currentActor.id, actorName: currentActor.name, actorRole: currentActor.role,
    fromValue: null, toValue: "RECEIVED", accepted: true, note: "Request received through the resident portal.", occurredAt: now.toISOString(),
  });
  return (await rawCase(caseId)) as CaseRecord;
}

export async function assignCase(id: string, assigneeId: string, actor: Actor | null): Promise<CaseRecord> {
  await initDb();
  const record = await rawCase(id);
  if (!record) throw new WorkflowError("This request could not be found.", 404);
  if (!actor) await refuse(id, actor, "assignment", record.assigneeId, assigneeId, "Sign in as a supervisor to change assignments.");
  const currentActor = actor as Actor;
  if (currentActor.role !== "supervisor") await refuse(id, currentActor, "assignment", record.assigneeId, assigneeId, "Only a supervisor can assign requests.");
  const result = await client.execute({ sql: "SELECT id,name,role FROM users WHERE id=?", args: [assigneeId] });
  const assignee = result.rows[0] as unknown as { id: string; name: string; role: Role } | undefined;
  if (!assignee || assignee.role !== "officer") await refuse(id, currentActor, "assignment", record.assigneeId, assigneeId, "Choose an active municipal officer.");
  await client.execute({ sql: "UPDATE cases SET assignee_id=?, updated_at=? WHERE id=?", args: [assigneeId, new Date().toISOString(), id] });
  await addEvent({
    caseId: id, eventType: "assigned", actorId: currentActor.id, actorName: currentActor.name, actorRole: currentActor.role,
    fromValue: record.assigneeId, toValue: assigneeId, accepted: true, note: "Assigned to " + (assignee as { name: string }).name + ".",
  });
  return (await rawCase(id)) as CaseRecord;
}

export async function processEscalations(): Promise<number> {
  await initDb();
  const now = new Date().toISOString();
  const due = await client.execute({
    sql: "SELECT id,case_ref,title,assignee_id FROM cases WHERE due_at<=? AND escalated_at IS NULL AND state NOT IN ('RESOLVED','CLOSED')",
    args: [now],
  });
  let count = 0;
  for (const row of due.rows as unknown as Array<{ id: string; case_ref: string; title: string; assignee_id: string | null }>) {
    const result = await client.execute({
      sql: "UPDATE cases SET assignee_id='user-supervisor', escalated_at=?, escalation_level=1, updated_at=? WHERE id=? AND escalated_at IS NULL AND state NOT IN ('RESOLVED','CLOSED')",
      args: [now, now, row.id],
    });
    if (result.rowsAffected === 0) continue;
    if (row.assignee_id !== "user-supervisor") {
      await addEvent({
        caseId: row.id, eventType: "assigned", actorId: null, actorName: "Workflow rule", actorRole: "system",
        fromValue: row.assignee_id, toValue: "user-supervisor", accepted: true, note: "Automatically routed to the Ward Supervisor for an overdue response.", occurredAt: now,
      });
    }
    await addEvent({
      caseId: row.id, eventType: "escalated", actorId: null, actorName: "Deadline monitor", actorRole: "system",
      fromValue: null, toValue: "SUPERVISOR_REVIEW", accepted: true,
      note: "The response deadline passed. Escalated to the Ward Supervisor; the current workflow state is unchanged.", occurredAt: now,
    });
    count++;
  }
  return count;
}

export async function listAudit(actor: Actor): Promise<AuditEvent[]> {
  const result = actor.role === "citizen"
    ? await client.execute({
      sql: "SELECT e.*, c.case_ref, c.title FROM audit_events e LEFT JOIN cases c ON c.id=e.case_id WHERE c.citizen_id=? ORDER BY e.occurred_at DESC LIMIT 200",
      args: [actor.id],
    })
    : await client.execute("SELECT e.*, c.case_ref, c.title FROM audit_events e LEFT JOIN cases c ON c.id=e.case_id ORDER BY e.occurred_at DESC LIMIT 200");
  return result.rows.map((row) => {
    const e = row as unknown as Record<string, unknown>;
    return {
      id: String(e.id), caseId: e.case_id ? String(e.case_id) : null, eventType: String(e.event_type), actorId: e.actor_id ? String(e.actor_id) : null,
      actorName: String(e.actor_name), actorRole: String(e.actor_role), fromValue: e.from_value ? String(e.from_value) : null,
      toValue: e.to_value ? String(e.to_value) : null, accepted: Boolean(e.accepted), occurredAt: String(e.occurred_at),
      note: String(e.note), caseRef: e.case_ref ? String(e.case_ref) : null, title: e.title ? String(e.title) : null,
    };
  });
}

export async function listOfficers() {
  const result = await client.execute("SELECT id,name,email FROM users WHERE role='officer' ORDER BY name");
  return result.rows.map((row) => ({ id: String(row.id), name: String(row.name), email: String(row.email) }));
}

