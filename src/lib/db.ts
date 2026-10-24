import { createClient, type InStatement } from "@libsql/client";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const remoteUrl = process.env.TURSO_DATABASE_URL;
if (process.env.NODE_ENV === "production" && !remoteUrl) {
  throw new Error("TURSO_DATABASE_URL is required for persistent production storage.");
}

export const client = createClient({
  url: remoteUrl || "file:./govfix.db",
  authToken: process.env.TURSO_AUTH_TOKEN || undefined,
});

let initialization: Promise<void> | undefined;

export function makePasswordHash(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
}

export function checkPassword(password: string, stored: string): boolean {
  const [salt, digest] = stored.split(":");
  if (!salt || !digest) return false;
  const expected = Buffer.from(digest, "hex");
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

const ago = (hours: number) => new Date(Date.now() - hours * 3600000).toISOString();
const fromNow = (hours: number) => new Date(Date.now() + hours * 3600000).toISOString();

const samples = [
  { id: "case-2401", ref: "GF-2401", title: "Streetlight out beside Mirza Park", description: "The two lights by the north gate have been out for four nights. The path is very dark after sunset.", category: "Street lighting", priority: "High", state: "IN_PROGRESS", ward: "Ward 04", location: "Mirza Park, North Gate", created: 22, due: -16, path: ["TRIAGED", "IN_PROGRESS"] },
  { id: "case-2402", ref: "GF-2402", title: "Water leak on 4th Avenue", description: "A steady leak is coming from the road near house 18. Water is pooling near the crossing.", category: "Water supply", priority: "Standard", state: "RECEIVED", ward: "Ward 06", location: "4th Avenue, House 18", created: 19, due: 101, path: [] },
  { id: "case-2403", ref: "GF-2403", title: "Missed waste collection on Maple Lane", description: "Household bins have not been collected on our block since Monday.", category: "Waste & sanitation", priority: "High", state: "WAITING_FOR_CITIZEN", ward: "Ward 02", location: "Maple Lane, Block C", created: 60, due: -3, path: ["TRIAGED", "IN_PROGRESS", "WAITING_FOR_CITIZEN"] },
  { id: "case-2404", ref: "GF-2404", title: "Deep pothole near school crossing", description: "A large pothole has opened across the pedestrian crossing. It is difficult for students to cross safely.", category: "Roads & sidewalks", priority: "Critical", state: "TRIAGED", ward: "Ward 05", location: "Central School, East Crossing", created: 17, due: 7, path: ["TRIAGED"] },
  { id: "case-2405", ref: "GF-2405", title: "Drain grate blocked before rain", description: "Leaves and debris have blocked the drain outside building 32. Water is already backing up.", category: "Drainage & flooding", priority: "High", state: "IN_PROGRESS", ward: "Ward 03", location: "32 Willow Road", created: 87, due: -22, path: ["TRIAGED", "IN_PROGRESS"] },
  { id: "case-2406", ref: "GF-2406", title: "Park light flickering near East Field", description: "One light flickers and goes out intermittently beside the walking track.", category: "Parks & public spaces", priority: "Standard", state: "RECEIVED", ward: "Ward 07", location: "East Field walking track", created: 13, due: 107, path: [] },
  { id: "case-2407", ref: "GF-2407", title: "Low water pressure in Ward 06", description: "Pressure has been low in the mornings for the past week on our street.", category: "Water supply", priority: "Standard", state: "RESOLVED", ward: "Ward 06", location: "Juniper Street", created: 135, due: -15, path: ["TRIAGED", "IN_PROGRESS", "RESOLVED"] },
  { id: "case-2408", ref: "GF-2408", title: "Illegal dumping at Bell Street corner", description: "Construction waste has been left beside the public bins.", category: "Waste & sanitation", priority: "Low", state: "CLOSED", ward: "Ward 01", location: "Bell Street & 2nd", created: 240, due: -72, path: ["TRIAGED", "IN_PROGRESS", "RESOLVED", "CLOSED"] },
];

async function seed() {
  const password = process.env.GOVFIX_DEMO_PASSWORD || (process.env.NODE_ENV === "production" ? "" : "GovfixDemo2026!");
  if (!password) throw new Error("Set GOVFIX_DEMO_PASSWORD before starting production.");
  const people = [
    ["user-citizen", "Aarav Mehta", "citizen@govfix.demo", "citizen"],
    ["user-officer", "Nisha Rao", "officer@govfix.demo", "officer"],
    ["user-supervisor", "Karan Shah", "supervisor@govfix.demo", "supervisor"],
  ];
  for (const [id, name, email, role] of people) {
    const found = await client.execute({ sql: "SELECT id FROM users WHERE id = ?", args: [id] });
    if (found.rows.length === 0) {
      await client.execute({
        sql: "INSERT INTO users (id,name,email,role,password_hash,created_at) VALUES (?,?,?,?,?,?)",
        args: [id, name, email, role, makePasswordHash(password), new Date().toISOString()],
      });
    }
  }

  const count = await client.execute("SELECT COUNT(*) AS count FROM cases");
  if (Number(count.rows[0]?.count || 0) > 0) return;
  for (const c of samples) {
    const createdAt = ago(c.created);
    await client.execute({
      sql: "INSERT INTO cases (id,case_ref,title,description,category,priority,state,ward,location,citizen_id,assignee_id,due_at,escalation_level,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)",
      args: [c.id,c.ref,c.title,c.description,c.category,c.priority,c.state,c.ward,c.location,"user-citizen",c.id === "case-2402" || c.id === "case-2406" ? null : "user-officer",c.due < 0 ? ago(Math.abs(c.due)) : fromNow(c.due),createdAt,createdAt],
    });
    await client.execute({
      sql: "INSERT INTO audit_events (id,case_id,event_type,actor_id,actor_name,actor_role,from_value,to_value,accepted,occurred_at,note) VALUES (?,?, 'submitted','user-citizen','Aarav Mehta','citizen',NULL,'RECEIVED',1,?,'Request received through the resident portal.')",
      args: ["event-" + c.id + "-submitted", c.id, createdAt],
    });
    let previous = "RECEIVED";
    for (let index = 0; index < c.path.length; index++) {
      const next = c.path[index];
      const eventTime = ago(Math.max(0, c.created - 2 - index * 2));
      const actorId = next === "CLOSED" ? "user-citizen" : "user-officer";
      const actorName = actorId === "user-citizen" ? "Aarav Mehta" : "Nisha Rao";
      await client.execute({
        sql: "INSERT INTO audit_events (id,case_id,event_type,actor_id,actor_name,actor_role,from_value,to_value,accepted,occurred_at,note) VALUES (?,?,?,?,?,?,?,?,1,?,?)",
        args: ["event-" + c.id + "-" + index, c.id, "transition", actorId, actorName, actorId === "user-citizen" ? "citizen" : "officer", previous, next, eventTime, next === "WAITING_FOR_CITIZEN" ? "A resident update is needed to continue." : "Workflow step completed."],
      });
      previous = next;
    }
    if (c.id !== "case-2402" && c.id !== "case-2406") {
      await client.execute({
        sql: "INSERT INTO audit_events (id,case_id,event_type,actor_id,actor_name,actor_role,from_value,to_value,accepted,occurred_at,note) VALUES (?,?, 'assigned','user-supervisor','Karan Shah','supervisor',NULL,'user-officer',1,?,'Case assigned to the municipal response team.')",
        args: ["event-" + c.id + "-assigned", c.id, ago(Math.max(0, c.created - 1))],
      });
    }
  }
}

export async function initDb(): Promise<void> {
  if (!initialization) {
    const statements: InStatement[] = [
      { sql: "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, role TEXT NOT NULL CHECK(role IN ('citizen','officer','supervisor')), password_hash TEXT NOT NULL, created_at TEXT NOT NULL)", args: [] },
      { sql: "CREATE TABLE IF NOT EXISTS cases (id TEXT PRIMARY KEY, case_ref TEXT NOT NULL UNIQUE, title TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL, priority TEXT NOT NULL, state TEXT NOT NULL, ward TEXT NOT NULL, location TEXT NOT NULL, citizen_id TEXT NOT NULL, assignee_id TEXT, due_at TEXT NOT NULL, escalated_at TEXT, escalation_level INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)", args: [] },
      { sql: "CREATE TABLE IF NOT EXISTS audit_events (id TEXT PRIMARY KEY, case_id TEXT, event_type TEXT NOT NULL, actor_id TEXT, actor_name TEXT NOT NULL, actor_role TEXT NOT NULL, from_value TEXT, to_value TEXT, accepted INTEGER NOT NULL, occurred_at TEXT NOT NULL, note TEXT NOT NULL)", args: [] },
      { sql: "CREATE INDEX IF NOT EXISTS idx_cases_state_due ON cases(state,due_at)", args: [] },
      { sql: "CREATE INDEX IF NOT EXISTS idx_audit_case_time ON audit_events(case_id,occurred_at DESC)", args: [] },
    ];
    initialization = client.batch(statements, "write").then(seed).catch((error) => {
      initialization = undefined;
      throw error;
    });
  }
  await initialization;
}

export function slaHours(priority: string): number {
  const values: Record<string, number> = { Critical: 24, High: 72, Standard: 120, Low: 168 };
  return values[priority] || 120;
}

