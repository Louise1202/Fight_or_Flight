"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
      <form onSubmit={handleSubmit} className="w-full max-w-xs space-y-4">
        <p className="text-center font-display text-xl">Admin access</p>
        <input
          type="password"
          placeholder="Admin password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="tap-target w-full rounded-md border border-fofGunmetal bg-transparent px-4"
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
    </main>
  );
}
