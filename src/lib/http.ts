import { NextResponse } from "next/server";
import { WorkflowError } from "./workflow";

export function jsonError(error: unknown) {
  if (error instanceof WorkflowError) {
    return NextResponse.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
  }
  console.error(error);
  return NextResponse.json({ error: "The request could not be completed. Please try again." }, { status: 500, headers: { "Cache-Control": "no-store" } });
}

export function unauthorized() {
  return NextResponse.json({ error: "Sign in to continue." }, { status: 401, headers: { "Cache-Control": "no-store" } });
}

