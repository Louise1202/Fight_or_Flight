"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import PasswordInput from "@/components/PasswordInput";

export default function AdminLoginPage() {
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

    setLoading(false);

    if (!res.ok) {
      setError("Wrong password.");
      return;
    }

    router.push("/admin");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6">
      <div className="w-full max-w-xs">
        <div className="mb-8 text-center">
          <img
            src="/logo.png"
            alt="Fight or Flight"
            className="mx-auto mb-4 h-[168px] w-[168px] rounded-full"
          />
          <p className="font-display text-3xl tracking-tight text-fofPaper">
            FIGHT <span className="text-fofRed">OR</span> FLIGHT
          </p>
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
          {error && <p className="text-sm text-fofRed">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="tap-target w-full rounded-md bg-fofRed font-display"
          >
            {loading ? "Checking..." : "Enter"}
          </button>
        </form>

        <div className="mt-12 flex items-center justify-center gap-8 opacity-70">
          <img src="/partners/the-box.png" alt="The Box Fitness Center" className="h-[60px] w-auto" />
          <img src="/partners/mission-to-move.png" alt="Mission to Move" className="h-[60px] w-auto" />
        </div>
      </div>
    </main>
  );
}
