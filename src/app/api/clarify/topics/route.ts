import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth";
import { listSharedTopics } from "@/lib/chat-sessions";

export async function GET() {
  try {
    const user = await getAuthedUser();
    if (!user) {
      return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
    }

    const topics = await listSharedTopics();
    return NextResponse.json({ topics }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
