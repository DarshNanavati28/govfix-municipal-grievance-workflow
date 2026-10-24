import { NextResponse } from "next/server";
import { initDb, client, checkPassword } from "@/lib/db";
import { findUser, publicActor, sessionCookie, signInToken } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await initDb();
    const body = await request.json();
    const email = String(body.email || "").trim();
    const password = String(body.password || "");
    const user = await findUser(email);
    if (!user || !checkPassword(password, user.password_hash)) {
      await client.execute({
        sql: "INSERT INTO audit_events (id,case_id,event_type,actor_id,actor_name,actor_role,from_value,to_value,accepted,occurred_at,note) VALUES (lower(hex(randomblob(16))),NULL,'sign_in_refused',NULL,?,'unknown',NULL,NULL,0,?,'Invalid demo sign-in credentials.')",
        args: [email || "Unidentified visitor", new Date().toISOString()],
      });
      return NextResponse.json({ error: "Those sign-in details were not recognized." }, { status: 401 });
    }
    const response = NextResponse.json({ actor: publicActor(user) }, { headers: { "Cache-Control": "no-store" } });
    response.headers.set("Set-Cookie", sessionCookie(signInToken(user.id)));
    return response;
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "The sign-in service is unavailable. Check the database connection." }, { status: 503 });
  }
}

