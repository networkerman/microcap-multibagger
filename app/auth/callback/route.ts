// Supabase magic-link callback.
// Supabase redirects here after the user clicks the link in their email.
// We exchange the one-time code for a session, write it to cookies, then
// bounce the user back to wherever they were (via the `next` query param).
import { NextResponse } from "next/server";
import { createAuthClient } from "@/lib/supabase/server-auth";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createAuthClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Bounce back to the page the user came from (e.g. /stock/BSE:AFCOM).
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Auth failed — redirect home with an error flag.
  return NextResponse.redirect(`${origin}/?error=auth_failed`);
}
