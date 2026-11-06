"use client";

import { useState, type FormEvent } from "react";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type AIChatResponse = {
  reply: string;
  board_update: Record<string, unknown> | null;
};

type AIChatSidebarProps = {
  canSend: boolean;
  onBoardUpdated: () => Promise<void>;
};

export const AIChatSidebar = ({
  canSend,
  onBoardUpdated,
}: AIChatSidebarProps) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submittedQuestion = question.trim();
    if (!submittedQuestion || isPending || !canSend) {
      return;
    }

    setError("");
    setQuestion("");
    setIsPending(true);
    setMessages((current) => [
      ...current,
      { role: "user", content: submittedQuestion },
    ]);

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          question: submittedQuestion,
          conversation: messages,
        }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { detail?: string };
        throw new Error(
          body.detail ?? `AI request failed (${response.status}).`
        );
      }

      const result = (await response.json()) as AIChatResponse;
      if (!result.reply?.trim()) {
        throw new Error("The AI returned an empty reply.");
      }

      if (result.board_update) {
        await onBoardUpdated();
      }
      setMessages((current) => [
        ...current,
        { role: "assistant", content: result.reply },
      ]);
    } catch (requestError) {
      const detail =
        requestError instanceof Error
          ? requestError.message
          : "Unknown error.";
      setError(
        `Unable to complete the AI request: ${detail} If the board changed, reload to see the saved changes.`
      );
    } finally {
      setIsPending(false);
    }
  };

  return (
    <aside className="flex min-h-[420px] min-w-0 flex-col overflow-hidden rounded-[28px] border border-[var(--stroke)] bg-white/90 shadow-[var(--shadow)] 2xl:sticky 2xl:top-6 2xl:max-h-[calc(100vh-3rem)]">
      <header className="border-b border-[var(--stroke)] px-5 py-5">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--gray-text)]">
          Project assistant
        </p>
        <h2 className="mt-2 font-display text-xl font-semibold text-[var(--navy-dark)]">
          AI chat
        </h2>
        <p className="mt-2 text-sm leading-5 text-[var(--gray-text)]">
          Ask questions or request changes to your board.
        </p>
      </header>

      <div
        className="flex flex-1 flex-col gap-3 overflow-y-auto p-4"
        aria-label="Chat messages"
        aria-live="polite"
      >
        {messages.length === 0 && (
          <p className="rounded-2xl bg-[var(--surface)] p-4 text-sm leading-5 text-[var(--gray-text)]">
            Try asking for a summary or a card update.
          </p>
        )}
        {messages.map((message, index) => (
          <div
            key={`${message.role}-${index}`}
            className={`max-w-[90%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-5 ${
              message.role === "user"
                ? "ml-auto bg-[var(--primary-blue)] text-white"
                : "mr-auto bg-[var(--surface)] text-[var(--navy-dark)]"
            }`}
          >
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.15em] opacity-75">
              {message.role === "user" ? "You" : "Assistant"}
            </p>
            {message.content}
          </div>
        ))}
        {isPending && (
          <p role="status" className="text-sm text-[var(--gray-text)]">
            Thinking...
          </p>
        )}
      </div>

      <form onSubmit={handleSubmit} className="border-t border-[var(--stroke)] p-4">
        {error && (
          <p role="alert" className="mb-3 text-sm leading-5 text-red-700">
            {error}
          </p>
        )}
        {!canSend && !isPending && (
          <p className="mb-3 text-xs leading-5 text-[var(--gray-text)]">
            Save your board changes before sending a chat message.
          </p>
        )}
        <label htmlFor="ai-question" className="sr-only">
          Message the AI assistant
        </label>
        <textarea
          id="ai-question"
          rows={3}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask about your project..."
          disabled={isPending}
          className="w-full resize-y rounded-xl border border-[var(--stroke)] bg-white px-3 py-3 text-sm text-[var(--navy-dark)] outline-none focus:border-[var(--primary-blue)] disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={isPending || !canSend || question.trim().length === 0}
          className="mt-3 w-full rounded-full bg-[var(--secondary-purple)] px-5 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Sending..." : "Send message"}
        </button>
      </form>
    </aside>
  );
};
