import { createHmac, timingSafeEqual } from "node:crypto";
import { client } from "./db";

export type Role = "citizen" | "officer" | "supervisor";
export interface Actor {
  id: string;
  name: string;
  email: string;
  role: Role;
}
type UserRow = { id: string; name: string; email: string; role: Role; password_hash: string };

function sessionSecret(): string {
  const value = process.env.GOVFIX_SESSION_SECRET;
  if (process.env.NODE_ENV === "production" && !value) {
    throw new Error("GOVFIX_SESSION_SECRET is required in production.");
  }
  return value || "local-only-govfix-session-secret-change-before-deploy";
}

export function signInToken(userId: string): string {
  const payload = Buffer.from(JSON.stringify({ sub: userId, exp: Date.now() + 12 * 60 * 60 * 1000 })).toString("base64url");
  const signature = createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
  return payload + "." + signature;
}

export function sessionCookie(token: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return "govfix_session=" + token + "; Path=/; Max-Age=43200; HttpOnly; SameSite=Lax" + secure;
}

export function clearSessionCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return "govfix_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax" + secure;
}

export async function findUser(email: string): Promise<UserRow | undefined> {
  const result = await client.execute({ sql: "SELECT id,name,email,role,password_hash FROM users WHERE email = ? COLLATE NOCASE", args: [email.trim()] });
  return result.rows[0] as unknown as UserRow | undefined;
}

function readToken(request: Request): string | undefined {
  const cookieHeader = request.headers.get("cookie") || "";
  const item = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith("govfix_session="));
  return item?.slice("govfix_session=".length);
}

export async function getActor(request: Request): Promise<Actor | null> {
  const token = readToken(request);
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  try {
    const expected = createHmac("sha256", sessionSecret()).update(payload).digest();
    const actual = Buffer.from(signature, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: string; exp?: number };
    if (!claims.sub || !claims.exp || claims.exp < Date.now()) return null;
    const result = await client.execute({ sql: "SELECT id,name,email,role FROM users WHERE id = ?", args: [claims.sub] });
    const user = result.rows[0] as unknown as Actor | undefined;
    return user || null;
  } catch {
    return null;
  }
}

export function publicActor(user: UserRow): Actor {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

