"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import PasswordInput from "@/components/PasswordInput";
import BuiltBy from "@/components/BuiltBy";
import type { LoginBrand } from "@/components/login/LoginForm";

export default function AdminLoginForm({ brand }: { brand: LoginBrand }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    if (!res.ok) {
      setLoading(false);
      setError(res.status === 429 ? "Too many attempts. Wait 15 minutes and try again." : "Wrong password.");
      return;
    }

    router.push("/admin");
    router.refresh();
  }

  return (
    <main
      data-brand={brand.theme}
      className="ground flex min-h-screen flex-col items-center justify-center bg-fofBlack px-6 text-fofPaper"
    >
      <div className="w-full max-w-xs">
        <div className="mb-8 text-center">
          <img
            src={brand.logo}
            alt={brand.name}
            className={`mx-auto mb-4 h-[168px] w-[168px] ${brand.logoRound ? "logo-round" : "rounded-full"}`}
          />
          <p className="font-display text-3xl tracking-tight text-fofPaper">{brand.name.toUpperCase()}</p>
          <p className="mt-1 text-sm text-fofGunmetal">Admin access</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <PasswordInput
            placeholder="Admin password"
            value={password}
            onChange={setPassword}
            className="tap-target w-full rounded-md border border-fofGunmetal bg-transparent px-4 pr-12"
            autoFocus
          />
          {error && (
            <p role="alert" className="text-sm text-fofRed">
              {error}
            </p>
          )}
          <button type="submit" disabled={loading} className="tap-target w-full rounded-md btn-stamped font-display">
            {loading ? "Checking..." : "Enter"}
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
