import { NextResponse } from "next/server";
import { loadProfile, saveProfile } from "@/lib/storage";
import type { Profile } from "@/lib/types";

// The profile changes between requests (I edit it), so never cache.
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await loadProfile());
}

export async function PUT(request: Request) {
  let body: Profile;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!Array.isArray(body.experiences) || typeof body.settings?.defaultCharLimit !== "number") {
    return NextResponse.json({ error: "Malformed profile" }, { status: 400 });
  }
  await saveProfile(body);
  return NextResponse.json({ ok: true });
}
