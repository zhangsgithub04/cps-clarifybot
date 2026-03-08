"use client";

import { FormEvent, KeyboardEvent as ReactKeyboardEvent, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";

type ChatMessage = {
  role: "assistant" | "user";
  content: string;
};

type ChatSessionSummary = {
  id: string;
  title: string;
  topicPrompt: string;
  isSessionShared: boolean;
  isTopicShared: boolean;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
};

type SharedTopicSummary = {
  id: string;
  title: string;
  topicPrompt: string;
  updatedAt: string;
};

type PublicUser = {
  id: string;
  email: string;
  createdAt: string;
};

type AuthMode = "signin" | "signup";
type GuidedStage = "challenge" | "gather" | "hits" | "complete";
type LlmProvider = "openai" | "gemini";

const INITIAL_ASSISTANT_MESSAGE =
  "Please paste your challenge using the starter **'It would be great if I/We...'**. For more information, refer to the **Clarify Step 1** section of the guide.";

function extractTextCodeBlocks(content: string): string[] {
  const blocks: string[] = [];
  const regex = /```text\s*([\s\S]*?)```/gi;
  let match = regex.exec(content);

  while (match) {
    blocks.push(match[1].trim());
    match = regex.exec(content);
  }

  return blocks;
}

function parseNumberedItems(block: string): string[] {
  return block
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^\d{1,2}\s*[).]\s+/.test(line))
    .map((line) => line.replace(/^\d{1,2}\s*[).]\s+/, "").trim());
}

function parseNumberedItemsFromContent(content: string): string[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^\d{1,2}\s*[).]\s+/.test(line))
    .map((line) => line.replace(/^\d{1,2}\s*[).]\s+/, "").trim())
    .filter((line) => line.length > 0);
}

function parseFocusOptionsFromContent(content: string): string[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[-*•]\s+what might be all the ways to\b/i.test(line))
    .map((line) => line.replace(/^[-*•]\s+/, "").trim());
}

function deriveGuidedStep(assistantReply: string): {
  stage: GuidedStage;
  gatherQuestions: string[];
  creativeQuestions: string[];
} {
  const blocks = extractTextCodeBlocks(assistantReply);
  const numberedSets: string[][] = blocks
    .map((block) => parseNumberedItems(block))
    .filter((items) => items.length > 0);

  const inlineNumberedItems = parseNumberedItemsFromContent(assistantReply);
  if (inlineNumberedItems.length > 0) {
    numberedSets.push(inlineNumberedItems);
  }

  if (numberedSets.length === 0) {
    if (assistantReply.includes("Great work! You now have a selection of focus questions")) {
      return { stage: "complete", gatherQuestions: [], creativeQuestions: [] };
    }
    return { stage: "challenge", gatherQuestions: [], creativeQuestions: [] };
  }

  const latest = numberedSets[numberedSets.length - 1];
  const isCreativeQuestionList = latest.every((item) => /^what might be all the ways to\b/i.test(item));

  if (isCreativeQuestionList) {
    return { stage: "hits", gatherQuestions: [], creativeQuestions: latest };
  }

  if (latest.length >= 6) {
    return { stage: "gather", gatherQuestions: latest, creativeQuestions: [] };
  }

  return { stage: "challenge", gatherQuestions: [], creativeQuestions: [] };
}

export default function Home() {
  const [authMode, setAuthMode] = useState<AuthMode>("signin");
  const [user, setUser] = useState<PublicUser | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [provider, setProvider] = useState<LlmProvider>("openai");
  const [registrationKey, setRegistrationKey] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: INITIAL_ASSISTANT_MESSAGE },
  ]);

  const [guidedStage, setGuidedStage] = useState<GuidedStage>("challenge");
  const [gatherQuestions, setGatherQuestions] = useState<string[]>([]);
  const [gatherAnswers, setGatherAnswers] = useState<string[]>([]);
  const [gatherIndex, setGatherIndex] = useState(0);
  const [creativeQuestions, setCreativeQuestions] = useState<string[]>([]);
  const [selectedHitNumbers, setSelectedHitNumbers] = useState<number[]>([]);
  const [focusOptions, setFocusOptions] = useState<string[]>([]);
  const [selectedFocusOptions, setSelectedFocusOptions] = useState<number[]>([]);
  const [focusDraft, setFocusDraft] = useState("");
  const [combineLoading, setCombineLoading] = useState(false);
  const [combineError, setCombineError] = useState("");
  const [guidedError, setGuidedError] = useState("");

  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [savedSessions, setSavedSessions] = useState<ChatSessionSummary[]>([]);
  const [sharedTopics, setSharedTopics] = useState<SharedTopicSummary[]>([]);
  const [loadingSessionId, setLoadingSessionId] = useState<string | null>(null);

  useEffect(() => {
    async function loadSession() {
      try {
        const response = await fetch("/api/auth/me", { cache: "no-store" });
        const payload = (await response.json()) as { authenticated?: boolean; user?: PublicUser };
        if (response.ok && payload.authenticated && payload.user) {
          setUser(payload.user);
        }
      } finally {
        setIsCheckingAuth(false);
      }
    }

    void loadSession();
  }, []);

  useEffect(() => {
    if (!user) {
      setSavedSessions([]);
      setSharedTopics([]);
      setActiveSessionId(null);
      return;
    }

    void refreshSessions();
    void refreshSharedTopics();
  }, [user]);

  async function refreshSessions(): Promise<ChatSessionSummary[]> {
    const response = await fetch("/api/clarify/sessions", { cache: "no-store" });
    const payload = (await response.json()) as { sessions?: ChatSessionSummary[] };
    if (response.ok && Array.isArray(payload.sessions)) {
      setSavedSessions(payload.sessions);
      return payload.sessions;
    }
    return [];
  }

  async function refreshSharedTopics(): Promise<void> {
    const response = await fetch("/api/clarify/topics", { cache: "no-store" });
    const payload = (await response.json()) as { topics?: SharedTopicSummary[] };
    if (response.ok && Array.isArray(payload.topics)) {
      setSharedTopics(payload.topics);
    }
  }

  function resetGuidedState(): void {
    setGuidedStage("challenge");
    setGatherQuestions([]);
    setGatherAnswers([]);
    setGatherIndex(0);
    setCreativeQuestions([]);
    setSelectedHitNumbers([]);
    setFocusOptions([]);
    setSelectedFocusOptions([]);
    setFocusDraft("");
    setCombineError("");
    setGuidedError("");
  }

  function startNewSession(): void {
    setActiveSessionId(null);
    setMessages([{ role: "assistant", content: INITIAL_ASSISTANT_MESSAGE }]);
    setInput("");
    setError("");
    resetGuidedState();
  }

  function applyGuidedStateFromReply(reply: string): void {
    const next = deriveGuidedStep(reply);

    if (next.stage === "gather") {
      setGuidedStage("gather");
      setGatherQuestions(next.gatherQuestions);
      setGatherAnswers(next.gatherQuestions.map(() => ""));
      setGatherIndex(0);
      setCreativeQuestions([]);
      setSelectedHitNumbers([]);
      setGuidedError("");
      return;
    }

    if (next.stage === "hits") {
      setGuidedStage("hits");
      setCreativeQuestions(next.creativeQuestions);
      setSelectedHitNumbers([]);
      setFocusOptions([]);
      setSelectedFocusOptions([]);
      setFocusDraft("");
      setCombineError("");
      setGuidedError("");
      return;
    }

    if (next.stage === "complete") {
      setGuidedStage("complete");
      const options = parseFocusOptionsFromContent(reply);
      setFocusOptions(options);
      setSelectedFocusOptions([]);
      setFocusDraft((current) => current || options[0] || "");
      setCombineError("");
      setGuidedError("");
      return;
    }

    setGuidedStage("challenge");
    setGuidedError("");
  }

  async function submitUserMessage(rawContent: string): Promise<void> {
    const trimmed = rawContent.trim();
    if (!trimmed || isLoading || !user || guidedStage === "complete") return;

    const nextMessages = [...messages, { role: "user" as const, content: trimmed }];
    setMessages(nextMessages);
    setInput("");
    setError("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/clarify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: nextMessages,
          sessionId: activeSessionId,
          provider,
        }),
      });

      const payload = (await response.json()) as { reply?: string; error?: string; sessionId?: string };
      if (!response.ok || !payload.reply) {
        throw new Error(payload.error || "Failed to generate Clarify response.");
      }

      setMessages((current) => [...current, { role: "assistant", content: payload.reply as string }]);
      if (payload.sessionId) {
        setActiveSessionId(payload.sessionId);
      }

      applyGuidedStateFromReply(payload.reply);
      await refreshSessions();
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : "An unexpected error occurred while contacting Clarify Bot.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }

  async function loadChatSession(sessionId: string): Promise<void> {
    if (isLoading || loadingSessionId) return;

    setLoadingSessionId(sessionId);
    setError("");

    try {
      const response = await fetch(`/api/clarify/sessions/${encodeURIComponent(sessionId)}`, { cache: "no-store" });
      const payload = (await response.json()) as {
        session?: { id: string; messages: ChatMessage[] };
        error?: string;
      };

      if (!response.ok || !payload.session) {
        throw new Error(payload.error ?? "Unable to load session.");
      }

      setMessages(payload.session.messages);
      setActiveSessionId(payload.session.id);

      const lastAssistant = [...payload.session.messages].reverse().find((item) => item.role === "assistant");
      if (lastAssistant) {
        applyGuidedStateFromReply(lastAssistant.content);
      } else {
        resetGuidedState();
      }
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "Failed to load this session.";
      setError(message);
    } finally {
      setLoadingSessionId(null);
    }
  }

  async function deleteSession(sessionId: string): Promise<void> {
    if (isLoading) return;

    const response = await fetch(`/api/clarify/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(payload.error ?? "Failed to delete session.");
      return;
    }

    if (activeSessionId === sessionId) {
      startNewSession();
    }

    await refreshSessions();
    await refreshSharedTopics();
  }

  async function toggleSessionShare(
    sessionId: string,
    target: "session" | "topic",
    isShared: boolean,
  ): Promise<void> {
    const response = await fetch(`/api/clarify/sessions/${encodeURIComponent(sessionId)}/share`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ target, isShared }),
    });

    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(payload.error ?? "Failed to update sharing setting.");
      return;
    }

    await refreshSessions();
    await refreshSharedTopics();
  }

  function applySharedTopic(topicPrompt: string): void {
    startNewSession();
    setInput(topicPrompt);
    setGuidedStage("challenge");
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (authLoading) return;

    setAuthError("");
    setAuthLoading(true);

    try {
      const endpoint = authMode === "signup" ? "/api/auth/signup" : "/api/auth/signin";
      const body =
        authMode === "signup"
          ? {
              email: authEmail,
              password: authPassword,
              registrationKey,
            }
          : {
              email: authEmail,
              password: authPassword,
            };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const payload = (await response.json()) as { user?: PublicUser; error?: string };
      if (!response.ok || !payload.user) {
        throw new Error(payload.error ?? "Authentication failed.");
      }

      setUser(payload.user);
      setAuthPassword("");
      setRegistrationKey("");
      startNewSession();
      await refreshSessions();
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "Unexpected authentication error.";
      setAuthError(message);
    } finally {
      setAuthLoading(false);
    }
  }

  async function signOut(): Promise<void> {
    await fetch("/api/auth/signout", { method: "POST" });
    setUser(null);
    startNewSession();
    setSavedSessions([]);
    setSharedTopics([]);
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitUserMessage(input);
  }

  async function submitGatherAnswers(): Promise<void> {
    const hasAnyAnswer = gatherAnswers.some((answer) => answer.trim().length > 0);
    if (!hasAnyAnswer) {
      setGuidedError("Add at least one response before submitting Gather Data.");
      return;
    }

    const block = gatherQuestions
      .map((question, index) => {
        const answer = gatherAnswers[index]?.trim() || "No response provided.";
        return `${index + 1}) ${question}\n${answer}`;
      })
      .join("\n\n");

    await submitUserMessage(block);
  }

  function updateCurrentGatherAnswer(value: string): void {
    const next = [...gatherAnswers];
    next[gatherIndex] = value;
    setGatherAnswers(next);
    if (guidedError) setGuidedError("");
  }

  function goToPreviousGatherQuestion(): void {
    setGatherIndex((current) => Math.max(0, current - 1));
  }

  function goToNextGatherQuestion(): void {
    setGatherIndex((current) => Math.min(gatherQuestions.length - 1, current + 1));
  }

  function onChatTextareaKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();

    if (isLoading || guidedStage === "complete" || input.trim().length === 0) return;
    void submitUserMessage(input);
  }

  function onGatherTextareaKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();

    if (isLoading) return;
    if (isLastGatherQuestion) {
      void submitGatherAnswers();
      return;
    }

    goToNextGatherQuestion();
  }

  async function submitHitNumbers(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (selectedHitNumbers.length === 0) {
      setGuidedError("Pick at least one hit before submitting.");
      return;
    }

    const payload = [...selectedHitNumbers].sort((a, b) => a - b).join(", ");
    await submitUserMessage(payload);
  }

  function onHitsFormKeyDown(event: ReactKeyboardEvent<HTMLFormElement>): void {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    if (isLoading) return;

    if (selectedHitNumbers.length === 0) {
      setGuidedError("Pick at least one hit before submitting.");
      return;
    }

    const payload = [...selectedHitNumbers].sort((a, b) => a - b).join(", ");
    void submitUserMessage(payload);
  }

  function toggleHit(index: number): void {
    const number = index + 1;
    setSelectedHitNumbers((current) =>
      current.includes(number) ? current.filter((value) => value !== number) : [...current, number],
    );
  }

  function toggleFocusOption(index: number): void {
    setSelectedFocusOptions((current) =>
      current.includes(index) ? current.filter((value) => value !== index) : [...current, index],
    );
    if (combineError) setCombineError("");
  }

  async function combineSelectedFocusOptions(): Promise<void> {
    const options = selectedFocusOptions.map((idx) => focusOptions[idx]).filter(Boolean);
    if (options.length < 2) {
      setCombineError("Select at least two options to combine with AI.");
      return;
    }

    setCombineLoading(true);
    setCombineError("");

    try {
      const response = await fetch("/api/clarify/focus", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          options,
          context: "Create one strong Focus Question for Clarify Step 5.",
          provider,
        }),
      });

      const payload = (await response.json()) as { combined?: string; error?: string };
      if (!response.ok || !payload.combined) {
        throw new Error(payload.error ?? "Unable to combine selected options.");
      }

      setFocusDraft(payload.combined);
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "Failed to combine options.";
      setCombineError(message);
    } finally {
      setCombineLoading(false);
    }
  }

  if (isCheckingAuth) {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_15%_10%,#f7eed4_0%,#edf2f4_45%,#eaf4eb_100%)] p-4 sm:p-8">
        <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 rounded-3xl border border-black/10 bg-white/90 p-6 shadow-xl backdrop-blur">
          <p className="text-sm text-muted-foreground">Checking session...</p>
        </main>
      </div>
    );
  }

  const gatherTotal = gatherQuestions.length;
  const gatherCurrentQuestion = gatherQuestions[gatherIndex] ?? "";
  const gatherCurrentAnswer = gatherAnswers[gatherIndex] ?? "";
  const gatherCompletedCount = gatherAnswers.filter((answer) => answer.trim().length > 0).length;
  const isFirstGatherQuestion = gatherIndex === 0;
  const isLastGatherQuestion = gatherTotal > 0 && gatherIndex === gatherTotal - 1;

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_15%_10%,#f7eed4_0%,#edf2f4_45%,#eaf4eb_100%)] p-4 sm:p-8">
      <main className="mx-auto grid w-full max-w-6xl gap-4 lg:grid-cols-[280px_1fr]">
        {user ? (
          <aside className="space-y-4">
            <section className="rounded-3xl border border-black/10 bg-white/90 p-4 shadow-xl backdrop-blur sm:p-5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-[#1e2a38]">Sessions</h2>
                <Button type="button" variant="outline" className="h-8" onClick={startNewSession}>
                  New
                </Button>
              </div>

              <div className="mt-3 space-y-2">
                {savedSessions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No saved sessions yet.</p>
                ) : (
                  savedSessions.map((session) => (
                    <div
                      key={session.id}
                      className={`rounded-xl border px-3 py-2 text-left text-xs transition ${
                        activeSessionId === session.id
                          ? "border-[#2f6a4f] bg-[#e9f4ee]"
                          : "border-black/10 bg-white hover:bg-[#f8faf9]"
                      }`}
                    >
                      <button
                        type="button"
                        className="w-full text-left"
                        onClick={() => void loadChatSession(session.id)}
                        disabled={loadingSessionId === session.id}
                      >
                        <p className="truncate font-medium text-[#1f2933]">{session.title}</p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {new Date(session.updatedAt).toLocaleString()}
                        </p>
                      </button>

                      <div className="mt-2 flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="h-7 text-[11px]"
                          onClick={() =>
                            void toggleSessionShare(session.id, "topic", !session.isTopicShared)
                          }
                        >
                          {session.isTopicShared ? "Unshare Topic" : "Share Topic"}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-7 text-[11px]"
                          onClick={() =>
                            void toggleSessionShare(session.id, "session", !session.isSessionShared)
                          }
                        >
                          {session.isSessionShared ? "Unshare Session" : "Share Session"}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-7 text-[11px]"
                          onClick={() => void deleteSession(session.id)}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="rounded-3xl border border-black/10 bg-white/90 p-4 shadow-xl backdrop-blur sm:p-5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-[#1e2a38]">Shared Topics</h2>
                <Button type="button" variant="outline" className="h-8" onClick={() => void refreshSharedTopics()}>
                  Refresh
                </Button>
              </div>

              <div className="mt-3 space-y-2">
                {sharedTopics.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No shared topics yet.</p>
                ) : (
                  sharedTopics.map((topic) => (
                    <div key={topic.id} className="rounded-xl border border-black/10 bg-white px-3 py-2 text-xs">
                      <p className="truncate font-medium text-[#1f2933]">{topic.title}</p>
                      <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{topic.topicPrompt}</p>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className="text-[11px] text-muted-foreground">
                          {new Date(topic.updatedAt).toLocaleDateString()}
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-7 text-[11px]"
                          onClick={() => applySharedTopic(topic.topicPrompt)}
                        >
                          Use Topic
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </aside>
        ) : null}

        <section className="flex flex-col gap-4 rounded-3xl border border-black/10 bg-white/90 p-4 shadow-xl backdrop-blur sm:p-6">
          <header className="rounded-2xl bg-[#1e2a38] p-5 text-[#f8f4e7]">
            <p className="text-xs uppercase tracking-[0.18em] text-[#d4e1eb]">SUNY Buffalo Clarify</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Clarify Bot</h1>
            <p className="mt-2 max-w-2xl text-sm text-[#d9e4eb] sm:text-base">
              Clarify-stage facilitator for challenge framing, context gathering, and focus-question options.
            </p>
            {user ? (
              <div className="mt-4 flex items-center justify-between gap-2 rounded-xl bg-white/10 px-3 py-2 text-xs">
                <span>Signed in as {user.email}</span>
                <Button type="button" variant="secondary" className="h-8" onClick={() => void signOut()}>
                  Sign out
                </Button>
              </div>
            ) : null}
            {user ? (
              <div className="mt-2 flex items-center gap-2 text-xs text-[#d9e4eb]">
                <span>Provider</span>
                <select
                  className="rounded-md border border-white/20 bg-white/10 px-2 py-1 text-[#f8f4e7] outline-none"
                  value={provider}
                  onChange={(event) => setProvider(event.target.value as LlmProvider)}
                >
                  <option value="openai">OpenAI (default)</option>
                  <option value="gemini">Gemini</option>
                </select>
              </div>
            ) : null}
          </header>

          {!user ? (
            <section className="rounded-2xl border border-black/10 bg-[#fbfbf9] p-4 sm:p-5">
              <div className="mb-4 flex gap-2">
                <Button
                  type="button"
                  variant={authMode === "signin" ? "default" : "outline"}
                  onClick={() => {
                    setAuthMode("signin");
                    setAuthError("");
                  }}
                >
                  Sign in
                </Button>
                <Button
                  type="button"
                  variant={authMode === "signup" ? "default" : "outline"}
                  onClick={() => {
                    setAuthMode("signup");
                    setAuthError("");
                  }}
                >
                  Sign up
                </Button>
              </div>

              <form className="space-y-3" onSubmit={submitAuth}>
                <input
                  className="w-full rounded-xl border border-black/15 bg-white px-4 py-2.5 text-sm outline-none focus:border-[#2f6a4f]"
                  type="email"
                  placeholder="Email"
                  value={authEmail}
                  onChange={(event) => setAuthEmail(event.target.value)}
                  required
                />
                <input
                  className="w-full rounded-xl border border-black/15 bg-white px-4 py-2.5 text-sm outline-none focus:border-[#2f6a4f]"
                  type="password"
                  placeholder="Password (min 8 characters)"
                  value={authPassword}
                  onChange={(event) => setAuthPassword(event.target.value)}
                  required
                  minLength={8}
                />
                {authMode === "signup" ? (
                  <input
                    className="w-full rounded-xl border border-black/15 bg-white px-4 py-2.5 text-sm outline-none focus:border-[#2f6a4f]"
                    type="text"
                    placeholder="Registration key"
                    value={registrationKey}
                    onChange={(event) => setRegistrationKey(event.target.value)}
                    required
                  />
                ) : null}

                {authError ? <p className="text-sm text-red-700">{authError}</p> : null}

                <Button type="submit" disabled={authLoading}>
                  {authLoading ? "Please wait..." : authMode === "signup" ? "Create account" : "Sign in"}
                </Button>
              </form>
            </section>
          ) : (
            <>
              <section className="max-h-[58vh] space-y-3 overflow-y-auto rounded-2xl border border-black/10 bg-[#fbfbf9] p-3 sm:p-4">
                {messages.map((message, index) => (
                  <article
                    key={`${message.role}-${index}`}
                    className={`rounded-2xl p-3 text-sm leading-relaxed sm:p-4 sm:text-[0.95rem] ${
                      message.role === "assistant"
                        ? "bg-[#edf2f7] text-[#1f2933]"
                        : "ml-auto max-w-[95%] bg-[#d7efe2] text-[#1e3a2e]"
                    }`}
                  >
                    {message.role === "assistant" ? (
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          p: ({ children }) => <p className="mb-2 whitespace-pre-wrap last:mb-0">{children}</p>,
                          ul: ({ children }) => <ul className="mb-2 list-disc pl-5 last:mb-0">{children}</ul>,
                          ol: ({ children }) => <ol className="mb-2 list-decimal pl-5 last:mb-0">{children}</ol>,
                          li: ({ children }) => <li className="mb-1">{children}</li>,
                          code: ({ children, className }) => {
                            const isBlock = Boolean(className?.includes("language-"));
                            if (isBlock) {
                              return (
                                <code className="block overflow-x-auto rounded-lg bg-[#0f1720] px-3 py-2 text-xs text-[#e8eef5]">
                                  {children}
                                </code>
                              );
                            }
                            return <code className="rounded bg-black/10 px-1 py-0.5 text-xs">{children}</code>;
                          },
                        }}
                      >
                        {message.content}
                      </ReactMarkdown>
                    ) : (
                      <p className="whitespace-pre-wrap">{message.content}</p>
                    )}
                  </article>
                ))}

                {isLoading ? (
                  <article className="rounded-2xl bg-[#edf2f7] p-3 text-sm text-[#1f2933] sm:p-4 sm:text-[0.95rem]">
                    Clarify Bot is thinking...
                  </article>
                ) : null}
              </section>

              {guidedStage === "gather" ? (
                <section className="space-y-4 rounded-2xl border border-[#2f6a4f]/20 bg-[#f4faf6] p-4 sm:p-5">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-[#214734]">Step 2 - Gather Data Wizard</p>
                    <span className="rounded-full bg-[#d9ecde] px-2.5 py-1 text-[11px] font-medium text-[#214734]">
                      {gatherCompletedCount}/{gatherTotal} answered
                    </span>
                  </div>

                  <div className="h-2 w-full overflow-hidden rounded-full bg-[#d7e9dc]">
                    <div
                      className="h-full rounded-full bg-[#2f6a4f] transition-all"
                      style={{ width: `${gatherTotal > 0 ? ((gatherIndex + 1) / gatherTotal) * 100 : 0}%` }}
                    />
                  </div>

                  <div className="rounded-xl border border-[#bfd7c6] bg-white p-4">
                    <p className="text-xs font-medium uppercase tracking-[0.08em] text-[#49745d]">
                      Question {gatherIndex + 1} of {gatherTotal}
                    </p>
                    <label className="mt-2 block text-base font-medium text-[#1f2933]">{gatherCurrentQuestion}</label>
                    <textarea
                      className="mt-3 min-h-28 w-full resize-y rounded-xl border border-black/15 bg-white px-3 py-2 text-sm outline-none focus:border-[#2f6a4f]"
                      value={gatherCurrentAnswer}
                      onChange={(event) => updateCurrentGatherAnswer(event.target.value)}
                      onKeyDown={onGatherTextareaKeyDown}
                      placeholder="Type your response for this question..."
                      disabled={isLoading}
                    />
                    <p className="mt-2 text-xs text-muted-foreground">
                      Tip: brief, concrete answers work best. You can leave questions blank and return later.
                    </p>
                  </div>

                  {guidedError ? <p className="text-sm text-red-700">{guidedError}</p> : null}

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={isLoading || isFirstGatherQuestion}
                        onClick={goToPreviousGatherQuestion}
                      >
                        Back
                      </Button>
                      {!isLastGatherQuestion ? (
                        <Button type="button" variant="outline" disabled={isLoading} onClick={goToNextGatherQuestion}>
                          Next Question
                        </Button>
                      ) : null}
                    </div>

                    {isLastGatherQuestion ? (
                      <Button type="button" disabled={isLoading} onClick={() => void submitGatherAnswers()}>
                        {isLoading ? "Submitting..." : "Submit Gather Data"}
                      </Button>
                    ) : (
                      <p className="text-xs text-muted-foreground">Continue to the last question to submit all answers.</p>
                    )}
                  </div>
                </section>
              ) : null}

              {guidedStage === "hits" ? (
                <form
                  className="space-y-3 rounded-2xl border border-[#2f6a4f]/20 bg-[#f4faf6] p-4"
                  onSubmit={submitHitNumbers}
                  onKeyDown={onHitsFormKeyDown}
                >
                  <p className="text-sm font-semibold text-[#214734]">Step 3 - Pick Your Hits</p>
                  <p className="text-xs text-muted-foreground">
                    Select the questions that feel like hits. We will submit only their numbers.
                  </p>

                  <div className="space-y-2">
                    {creativeQuestions.map((question, index) => {
                      const number = index + 1;
                      const selected = selectedHitNumbers.includes(number);

                      return (
                        <label
                          key={`${number}-${question}`}
                          className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
                            selected ? "border-[#2f6a4f] bg-[#eaf6ef]" : "border-black/10 bg-white"
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="mt-1"
                            checked={selected}
                            onChange={() => toggleHit(index)}
                            disabled={isLoading}
                          />
                          <span>
                            {number}) {question}
                          </span>
                        </label>
                      );
                    })}
                  </div>

                  {guidedError ? <p className="text-sm text-red-700">{guidedError}</p> : null}

                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">Selected: {selectedHitNumbers.length}</p>
                    <Button type="submit" disabled={isLoading}>
                      {isLoading ? "Submitting..." : "Submit Hit Numbers"}
                    </Button>
                  </div>
                </form>
              ) : null}

              {guidedStage !== "gather" && guidedStage !== "hits" && guidedStage !== "complete" ? (
                <form className="space-y-2" onSubmit={sendMessage}>
                  <textarea
                    className="min-h-28 w-full resize-y rounded-2xl border border-black/15 bg-white px-4 py-3 text-sm outline-none ring-0 transition focus:border-[#2f6a4f] focus:shadow-[0_0_0_3px_rgba(47,106,79,0.14)] disabled:opacity-60"
                    placeholder="Paste your current step response here..."
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={onChatTextareaKeyDown}
                    disabled={isLoading}
                  />
                  {error ? <p className="text-sm text-red-700">{error}</p> : null}
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">Stage: {guidedStage}</p>
                    <Button type="submit" disabled={isLoading || input.trim().length === 0}>
                      {isLoading ? "Sending..." : "Send"}
                    </Button>
                  </div>
                </form>
              ) : null}

              {guidedStage === "complete" ? (
                <section className="space-y-3 rounded-2xl border border-[#2f6a4f]/20 bg-[#f4faf6] p-4 sm:p-5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-[#214734]">Step 5 - Focus Question Composer</p>
                    <span className="text-xs text-muted-foreground">Select multiple and combine</span>
                  </div>
                  <p className="rounded-lg border border-[#cddfd3] bg-white px-3 py-2 text-xs text-[#315943]">
                    Chat is disabled at the final step. You can finalize your Focus Question below.
                  </p>

                  {focusOptions.length > 0 ? (
                    <div className="space-y-2">
                      {focusOptions.map((option, index) => {
                        const selected = selectedFocusOptions.includes(index);
                        return (
                          <label
                            key={`${index}-${option}`}
                            className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
                              selected ? "border-[#2f6a4f] bg-[#eaf6ef]" : "border-black/10 bg-white"
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="mt-1"
                              checked={selected}
                              onChange={() => toggleFocusOption(index)}
                              disabled={combineLoading}
                            />
                            <span>{option}</span>
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      No focus options were detected automatically in this response.
                    </p>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={combineLoading || selectedFocusOptions.length < 2}
                      onClick={() => void combineSelectedFocusOptions()}
                    >
                      {combineLoading ? "Combining..." : "Combine with AI"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={selectedFocusOptions.length !== 1}
                      onClick={() => {
                        const idx = selectedFocusOptions[0];
                        if (idx !== undefined) setFocusDraft(focusOptions[idx] || "");
                      }}
                    >
                      Use Selected As Draft
                    </Button>
                  </div>

                  {combineError ? <p className="text-sm text-red-700">{combineError}</p> : null}

                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium text-[#1f2933]">Editable Focus Question Draft</label>
                    <textarea
                      className="min-h-24 w-full resize-y rounded-xl border border-black/15 bg-white px-3 py-2 text-sm outline-none focus:border-[#2f6a4f]"
                      value={focusDraft}
                      onChange={(event) => setFocusDraft(event.target.value)}
                      placeholder="Your final focus question will appear here."
                    />
                  </div>
                </section>
              ) : null}
            </>
          )}
        </section>
      </main>
    </div>
  );
}
