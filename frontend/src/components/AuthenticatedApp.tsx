"use client";

import { useEffect, useState, type FormEvent } from "react";
import { KanbanBoard } from "@/components/KanbanBoard";

type AuthState = "checking" | "signed-out" | "signed-in" | "unavailable";

export const AuthenticatedApp = () => {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const checkSession = async () => {
    setError("");
    setAuthState("checking");
    try {
      const response = await fetch("/api/auth/session", {
        credentials: "same-origin",
      });
      if (response.status === 401) {
        setAuthState("signed-out");
        return;
      }
      if (!response.ok) {
        throw new Error(`Session check failed (${response.status}).`);
      }
      setAuthState("signed-in");
    } catch {
      setError("Unable to connect to the server. Please try again.");
      setAuthState("unavailable");
    }
  };

  useEffect(() => {
    void checkSession();
  }, []);

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ username, password }),
      });
      if (response.status === 401) {
        setError("Invalid username or password.");
        return;
      }
      if (!response.ok) {
        throw new Error(`Sign-in failed (${response.status}).`);
      }
      setPassword("");
      setAuthState("signed-in");
    } catch {
      setError("Unable to sign in. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogout = async () => {
    setError("");
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
      if (!response.ok) {
        throw new Error(`Logout failed (${response.status}).`);
      }
      setPassword("");
      setAuthState("signed-out");
    } catch {
      setError("Unable to log out. Please try again.");
    }
  };

  if (authState === "checking") {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p role="status" className="text-sm text-[var(--gray-text)]">
          Checking sign-in session...
        </p>
      </main>
    );
  }

  if (authState === "unavailable") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6">
        <p role="alert" className="text-sm text-[var(--gray-text)]">
          {error}
        </p>
        <button
          type="button"
          onClick={() => void checkSession()}
          className="rounded-full bg-[var(--secondary-purple)] px-5 py-3 text-sm font-semibold text-white"
        >
          Retry
        </button>
      </main>
    );
  }

  if (authState === "signed-in") {
    return (
      <>
        {error && (
          <p role="alert" className="px-6 pt-4 text-center text-sm text-red-700">
            {error}
          </p>
        )}
        <KanbanBoard onLogout={handleLogout} />
      </>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <section className="w-full max-w-md rounded-[32px] border border-[var(--stroke)] bg-white/90 p-8 shadow-[var(--shadow)]">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[var(--gray-text)]">
          Kanban Studio
        </p>
        <h1 className="mt-3 font-display text-3xl font-semibold text-[var(--navy-dark)]">
          Sign in
        </h1>
        <p className="mt-2 text-sm leading-6 text-[var(--gray-text)]">
          Sign in to open your project board.
        </p>
        <form onSubmit={handleLogin} className="mt-8 space-y-5">
          <div>
            <label
              htmlFor="username"
              className="mb-2 block text-sm font-semibold text-[var(--navy-dark)]"
            >
              Username
            </label>
            <input
              id="username"
              name="username"
              autoComplete="username"
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="w-full rounded-xl border border-[var(--stroke)] bg-white px-4 py-3 text-sm text-[var(--navy-dark)] outline-none focus:border-[var(--primary-blue)]"
            />
          </div>
          <div>
            <label
              htmlFor="password"
              className="mb-2 block text-sm font-semibold text-[var(--navy-dark)]"
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-xl border border-[var(--stroke)] bg-white px-4 py-3 text-sm text-[var(--navy-dark)] outline-none focus:border-[var(--primary-blue)]"
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-full bg-[var(--secondary-purple)] px-5 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
          >
            {isSubmitting ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
};
