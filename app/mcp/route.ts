import { createMcpHandler, type AuthInfo } from "@modelcontextprotocol/server";
import { buildServer } from "@/lib/mcp";
import { createTokenClient, isAllowedEmail } from "@/lib/supabase";

const handler = createMcpHandler(({ authInfo }) => buildServer(authInfo!.token));

// Accepts only access tokens minted by the Supabase OAuth server (they carry client_id)
// for the owner's account. A regular website session token is rejected.
async function authenticate(token: string): Promise<AuthInfo | null> {
  const { data, error } = await createTokenClient(token).auth.getClaims(token);
  const claims = data?.claims;
  const clientId = claims?.client_id;
  if (error || !claims || typeof clientId !== "string" || !isAllowedEmail(claims.email)) return null;
  // A revoked connection deletes its session; reject its still-unexpired tokens right away.
  const { data: active } = await createTokenClient(token).rpc("session_is_active");
  if (!active) return null;
  return { token, clientId, scopes: String(claims.scope ?? "").split(" ").filter(Boolean), expiresAt: claims.exp };
}

async function handle(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const auth = token ? await authenticate(token).catch(() => null) : null; // malformed JWTs throw
  if (!auth) {
    const metadata = `${new URL(request.url).origin}/.well-known/oauth-protected-resource/mcp`;
    return Response.json(
      { error: token ? "invalid_token" : "unauthorized" },
      {
        status: 401,
        headers: { "WWW-Authenticate": `Bearer resource_metadata="${metadata}"${token ? ', error="invalid_token"' : ""}` },
      },
    );
  }
  return handler.fetch(request, { authInfo: auth });
}

export { handle as GET, handle as POST, handle as DELETE };
