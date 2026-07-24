import { NextResponse } from "next/server";
import { listResumes } from "@/lib/storage";

// Folder contents change between requests (I add/edit files in Word).
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ resumes: await listResumes() });
}
