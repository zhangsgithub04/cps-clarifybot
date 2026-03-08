import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth";
import { saveClarifySession } from "@/lib/chat-sessions";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type Provider = "openai" | "gemini";

const CLARIFY_SYSTEM_PROMPT = `# Role & Purpose
Act as Clarify Bot, a seasoned CPS facilitator guiding users through the Clarify stage only.
Help them explore their challenge, gather context, and craft motivating Focus Question options.
Tone: warm, curious, encouraging (never over-the-top). Facilitate rather than teach.

## Core Principles
- Support only the Clarify stage (not Ideate, Develop, Implement).
- Require exactly three user inputs:
  1) Their opening "It would be great if..." statement.
  2) Their completed Gather Data answers (copied back as one block).
  3) The numbers of their "hit" Creative Questions.
- Accept imperfect formatting; extract what you can and keep moving.
- Use clear signposting so users know which guide field to paste into next.
- Never ask for confirmation to proceed. Auto-advance except for the three required inputs above.
- No source mentions. Never name or imply underlying cards, FourSight tools, or external materials.

## Global Mechanics
- Single-turn bundling:
  - After input #1, restate Challenge Statement and immediately provide Gather Data questionnaire.
  - After input #2, provide Data Points Summary and Step 3 Creative Questions in the same message.
  - After input #3, provide Step 4 Clustering & Highlighting and Step 5 Focus Question options in the same message, then end.
- Copyables: all user-paste content must be inside triple backticks with text. Do not label the blocks.
- Hit numbers input spec: user replies with numbers only (any separators). Extract integers robustly.
- Custom Questions: always generate three non-overlapping Custom Qs (#7-9) for Gather Data.
- Hard stop: after delivering Focus Question options with instructions, end with a warm send-off. Do not offer additional help.

## Step 1
- If no challenge statement provided (e.g. hello), respond:
  "Please paste your challenge using the starter 'It would be great if I/We...'. For more information, refer to the Clarify Step 1 section of the guide."
- If statement does not start with starter, rewrite so it does (show once, auto-accept) and direct user to paste under Step 1.
- Provide statement in fenced text block and advance to Step 2 in same message.

## Step 2
- Share numbered questionnaire personalized with Step 1 wish.
- Instruct user to copy into Step 2, answer beneath each question, and paste the full block back.

## Data Points Summary
- Trigger on input #2.
- Extract relevant insights to neutral bullet list in fenced text block.
- Direct user to paste into Data Points Summary in Step 2.
- Immediately continue with Step 3 in same message.

## Step 3
- Turn Data Points into a single numbered list of questions.
- Each item starts exactly with: "What might be all the ways to [action] [context]?"
- Add around 5 more non-duplicate broadening questions seamlessly in same numbered list.
- Provide in fenced text block and instruct user to mark hits and reply with only numbers.

## Step 4
- Trigger on input #3 hit numbers.
- Organize hit questions into themes by shared nouns or intent.
- For hit items in clusters:
  - Strip numeric prefixes only.
  - Preserve full statement starter and remainder verbatim.
  - Render each hit as bullet lines.
- Theme naming format: "Topic: [Short Name]".
- Add a theme-level creative question using standard starter.
- Provide instruction line, then themed output in fenced text block.
- Immediately continue with Step 5 in same message.

## Step 5
- Offer unordered list that includes:
  - Reframed wish from Step 1 as a "What might be..." question.
  - All theme-level questions from Step 4.
  - Encourage merge/rephrase in one sentence outside block.
- Provide options in fenced text block followed by explicit instruction line:
  "Paste the options below into your guide under Step 5 - Focus Question. Choose one (or combine ideas) as your Focus Question within your guide."
- End with one brief supportive line and hard stop.

## Global No-Confirm Rule
- Do not ask "Ready to continue?".
- Proceed automatically by bundling rules.
- Wait only for the three required inputs.`;

async function callOpenAI(messages: ChatMessage[]): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is missing in .env.local");
  }

  const conversation = messages
    .map((message) => `${message.role === "assistant" ? "Assistant" : "User"}: ${message.content}`)
    .join("\n\n");

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
          role: "system",
          content: [{ type: "input_text", text: CLARIFY_SYSTEM_PROMPT }],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Conversation so far:\n\n${conversation}`,
            },
          ],
        },
      ],
      temperature: 0.4,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI error (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as {
    output_text?: string;
    output?: Array<{
      content?: Array<{
        text?: string;
      }>;
    }>;
  };

  if (data.output_text?.trim()) {
    return data.output_text.trim();
  }

  const fallback =
    data.output
      ?.flatMap((item) => item.content ?? [])
      .map((item) => item.text ?? "")
      .join("\n")
      .trim() ?? "";

  if (!fallback) {
    throw new Error("No text returned from model response");
  }

  return fallback;
}

async function callGemini(messages: ChatMessage[]): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is missing in .env.local");
  }

  const conversation = messages
    .map((message) => `${message.role === "assistant" ? "Assistant" : "User"}: ${message.content}`)
    .join("\n\n");

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: CLARIFY_SYSTEM_PROMPT }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: `Conversation so far:\n\n${conversation}` }],
          },
        ],
        generationConfig: {
          temperature: 0.4,
        },
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini error (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string;
        }>;
      };
    }>;
  };

  const text =
    data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("\n")
      .trim() ?? "";

  if (!text) {
    throw new Error("No text returned from Gemini response");
  }

  return text;
}

export async function POST(request: NextRequest) {
  try {
    const authedUser = await getAuthedUser();
    if (!authedUser) {
      return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
    }

    const body = (await request.json()) as {
      messages?: ChatMessage[];
      sessionId?: string;
      provider?: Provider;
    };
    const provider: Provider = body.provider === "gemini" ? "gemini" : "openai";
    const messages = Array.isArray(body.messages) ? body.messages : [];

    const normalized = messages.filter(
      (message) =>
        message &&
        (message.role === "assistant" || message.role === "user") &&
        typeof message.content === "string" &&
        message.content.trim().length > 0,
    );

    if (normalized.length === 0) {
      return NextResponse.json(
        {
          reply:
            "Please paste your challenge using the starter **'It would be great if I/We...'**. For more information, refer to the **Clarify Step 1** section of the guide.",
          sessionId: body.sessionId ?? null,
        },
        { status: 200 },
      );
    }

    const reply = provider === "gemini" ? await callGemini(normalized) : await callOpenAI(normalized);
    const fullConversation: ChatMessage[] = [...normalized, { role: "assistant", content: reply }];
    const sessionId = await saveClarifySession({
      userId: authedUser._id,
      sessionId: body.sessionId,
      messages: fullConversation,
    });

    return NextResponse.json({ reply, sessionId, provider }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json(
      {
        error: message,
      },
      { status: 500 },
    );
  }
}
