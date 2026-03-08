import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth";

type CombineBody = {
  options?: string[];
  context?: string;
};

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthedUser();
    if (!user) {
      return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OPENAI_API_KEY is missing in .env.local" }, { status: 500 });
    }

    const body = (await request.json()) as CombineBody;
    const options = Array.isArray(body.options)
      ? body.options.map((item) => item.trim()).filter((item) => item.length > 0)
      : [];

    if (options.length < 2) {
      return NextResponse.json({ error: "Please provide at least two options to combine." }, { status: 400 });
    }

    const context = (body.context ?? "").trim();

    const prompt = [
      "You are helping combine focus-question options in a Clarify workflow.",
      "Return exactly one motivating focus question in one sentence.",
      "It must start with: What might be all the ways to",
      "Do not add bullets, numbering, quotes, or extra explanation.",
      context ? `Context: ${context}` : "",
      "Options:",
      ...options.map((option, idx) => `${idx + 1}. ${option}`),
    ]
      .filter(Boolean)
      .join("\n");

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: [
          {
            role: "user",
            content: [{ type: "input_text", text: prompt }],
          },
        ],
        temperature: 0.4,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json({ error: `OpenAI error (${response.status}): ${text}` }, { status: 500 });
    }

    const data = (await response.json()) as {
      output_text?: string;
      output?: Array<{ content?: Array<{ text?: string }> }>;
    };

    const output =
      data.output_text?.trim() ||
      data.output
        ?.flatMap((item) => item.content ?? [])
        .map((item) => item.text ?? "")
        .join("\n")
        .trim() ||
      "";

    if (!output) {
      return NextResponse.json({ error: "No text returned from model response." }, { status: 500 });
    }

    return NextResponse.json({ combined: output }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
