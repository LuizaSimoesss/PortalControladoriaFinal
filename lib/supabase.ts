import { createClient } from "@supabase/supabase-js";

// Server-side only — never import this in "use client" files.
export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
