"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { usernameToEmail } from "@/lib/username";
import PasswordInput from "@/components/PasswordInput";
import BuiltBy from "@/components/BuiltBy";

export type LoginBrand = {
  name: string;
  theme: string;
  logo: string;
  logoRound: boolean;
  partners: { src: string; alt: string }[];
};

export default function LoginForm({ brand }: { brand: LoginBrand }) {
  return (
    <Suspense fallback={null}>
      <Form brand={brand} />
    </Suspense>
  );
}

function Form({ brand }: { brand: LoginBrand }) {
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
      // Supabase Auth limits repeated attempts itself (status 429).
      setError(
        signInError.status === 429
          ? "Too many attempts. Wait a few minutes and try again."
          : "Wrong username or password. Try again."
      );
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <main
      data-brand={brand.theme}
      className="ground flex min-h-screen flex-col items-center justify-center bg-fofBlack px-6 text-fofPaper"
    >
      <div className="w-full max-w-sm">
        <div className="mb-10 text-center">
          <img
            src={brand.logo}
            alt={brand.name}
            className={`mx-auto mb-4 h-[168px] w-[168px] ${brand.logoRound ? "logo-round" : "rounded-full"}`}
          />
          <p className="font-display text-3xl tracking-tight text-fofPaper">{brand.name.toUpperCase()}</p>
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
            <PasswordInput id="password" required value={password} onChange={setPassword} />
          </div>

          {error && (
            <p role="alert" className="text-sm text-fofRed">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="tap-target w-full rounded-md btn-stamped font-display text-lg tracking-wide disabled:opacity-60"
          >
            {loading ? "Logging in..." : "Log in"}
          </button>
        </form>

        <div className="mt-12 flex items-center justify-center gap-8 opacity-70">
          {brand.partners.map((p) => (
            <img key={p.src} src={p.src} alt={p.alt} className="h-[60px] w-auto" />
          ))}
        </div>
        <BuiltBy className="mt-6" />
      </div>
    </main>
  );
}
