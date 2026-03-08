import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth";
import { setClarifySessionSharing } from "@/lib/chat-sessions";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthedUser();
    if (!user) {
      return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
    }

    const body = (await request.json()) as { isShared?: boolean; target?: "session" | "topic" };
    const { id } = await context.params;
    const isShared = Boolean(body.isShared);
    const target = body.target === "topic" ? "topic" : "session";

    const updated = await setClarifySessionSharing({
      userId: user._id,
      sessionId: id,
      target,
      isShared,
    });

    if (!updated) {
      return NextResponse.json({ error: "Session not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true, isShared, target }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
