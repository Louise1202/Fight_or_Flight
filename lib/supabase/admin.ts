import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// SERVER-ONLY. This key bypasses Row Level Security entirely.
// Only ever import this file from Server Components, Route Handlers,
// or Server Actions - never from anything that ships to the browser.
//
// Every request is sent with cache: "no-store". Next.js otherwise keeps
// its own copy of server-side fetches, and a route could keep answering
// with old data (seen in testing: the "names already taken" list stayed
// empty after a team had signed up).
const noStoreFetch: typeof fetch = (input, init) => fetch(input, { ...init, cache: "no-store" });

export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: noStoreFetch },
    }
  );
}
