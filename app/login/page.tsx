"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { usernameToEmail } from "@/lib/username";
import PasswordInput from "@/components/PasswordInput";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(
    params.get("error") === "no-role"
      ? "That login isn't set up for a team or judge yet. Check with the race organizer."
      : null
  );
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: usernameToEmail(username),
      password,
    });

    setLoading(false);

    if (signInError) {
      setError("Wrong username or password. Try again.");
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-10 text-center">
          <img
            src="/logo.png"
            alt="Fight or Flight"
            className="mx-auto mb-4 h-28 w-28 rounded-full"
          />
          <p className="font-display text-3xl tracking-tight text-fofPaper">
            FIGHT <span className="text-fofRed">OR</span> FLIGHT
          </p>
          <p className="mt-1 text-sm text-fofGunmetal">Race timing login</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="username" className="mb-1 block text-sm">
              Username
            </label>
            <input
              id="username"
              type="text"
              autoCapitalize="none"
              autoCorrect="off"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="tap-target w-full rounded-md border border-fofGunmetal bg-transparent px-4 text-lg text-fofPaper"
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-sm">
              Password
            </label>
            <PasswordInput
              id="password"
              required
              value={password}
              onChange={setPassword}
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-fofRed">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="tap-target w-full rounded-md bg-fofRed font-display text-lg tracking-wide disabled:opacity-60"
          >
            {loading ? "Logging in..." : "Log in"}
          </button>
        </form>

        <div className="mt-12 flex items-center justify-center gap-8 opacity-70">
          <img src="/partners/the-box.png" alt="The Box Fitness Center" className="h-10 w-auto" />
          <img src="/partners/mission-to-move.png" alt="Mission to Move" className="h-10 w-auto" />
        </div>
      </div>
    </main>
  );
}
