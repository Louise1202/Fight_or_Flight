"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LogoutButton() {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  return (
    <button
      disabled={leaving}
      aria-busy={leaving}
      onClick={async () => {
        setLeaving(true);
        const supabase = createClient();
        await supabase.auth.signOut();
        router.push("/login");
        router.refresh();
      }}
      className="rounded-md border border-fofGunmetal px-3 py-2 text-sm text-fofGunmetal hover:border-fofRed hover:text-fofRed"
    >
      {leaving ? "Logging out..." : "Log out"}
    </button>
  );
}