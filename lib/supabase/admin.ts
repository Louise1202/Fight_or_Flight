import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// SERVER-ONLY. This key bypasses Row Level Security entirely.
// Only ever import this file from Server Components, Route Handlers,
// or Server Actions - never from anything that ships to the browser.
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    }
  );
}
