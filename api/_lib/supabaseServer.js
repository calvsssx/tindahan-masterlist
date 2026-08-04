// Server-only. Reads Supabase credentials from environment variables that
// live in Vercel's Project Settings (or .env.local for `vercel dev`).
// This file is never sent to the browser — it only runs inside Serverless
// Functions under /api.

const { createClient } = require("@supabase/supabase-js");

function getEnv() {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Server is missing SUPABASE_URL / SUPABASE_ANON_KEY environment variables."
    );
  }
  return { url, anonKey };
}

// A fresh, unauthenticated client. Used for sign-in/sign-up (before we have
// a user session) and as the base client we attach a user's session to.
function anonClient() {
  const { url, anonKey } = getEnv();
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

module.exports = { anonClient };
