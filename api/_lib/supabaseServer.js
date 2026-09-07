// Server-only. Reads Supabase credentials from environment variables that
// live in Vercel's Project Settings (or .env.local for local dev).
// This file is never sent to the browser — it only runs inside Serverless
// Functions under /api.

const { createClient } = require("@supabase/supabase-js");

const BASE_AUTH_OPTS = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
};

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
// a user session) and for the refresh-token exchange.
function anonClient() {
  const { url, anonKey } = getEnv();
  return createClient(url, anonKey, { auth: BASE_AUTH_OPTS });
}

// A client that makes every PostgREST call as a specific signed-in user,
// by attaching their access token. Row Level Security is then enforced
// exactly as if that user had signed in directly from a browser. Supabase
// verifies the token's signature on every query, so a bad token gets
// nothing back.
function authedClient(accessToken) {
  const { url, anonKey } = getEnv();
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: BASE_AUTH_OPTS,
  });
}

module.exports = { anonClient, authedClient };
