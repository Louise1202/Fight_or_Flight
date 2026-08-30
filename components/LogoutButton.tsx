"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LogoutButton() {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        const supabase = createClient();
        await supabase.auth.signOut();
        router.push("/login");
        router.refresh();
      }}
      className="rounded-md border border-fofGunmetal px-3 py-2 text-sm text-fofGunmetal hover:border-fofRed hover:text-fofRed"
    >
      Log out
    </button>
  );
}
