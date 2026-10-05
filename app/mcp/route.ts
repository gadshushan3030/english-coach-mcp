import { requireMcpAuth } from "@better-auth/mcp";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { auth, MCP_RESOURCE } from "@/lib/auth";
import { sql } from "@/lib/db";
import { buildServer } from "@/lib/mcp";

const handler = createMcpHandler(({ authInfo }) => buildServer(String(authInfo?.extra?.userId)));

// requireMcpAuth verifies the JWT (signature via JWKS, issuer, audience = MCP_RESOURCE, expiry)
// and answers 401 + WWW-Authenticate otherwise. On top of that the token's user must still
// hold a consent row for the token's client – disconnecting in /progress deletes it and cuts access at once.
const protectedHandler = requireMcpAuth(
  auth,
  async (request, claims) => {
    const clientId = String(claims.azp ?? claims.client_id ?? "");
    const [consent] = await sql(`select 1 from "oauthConsent" where "userId" = $1 and "clientId" = $2`, [claims.sub, clientId]);
    if (!consent) {
      return Response.json({ jsonrpc: "2.0", error: { code: -32000, message: "connection revoked" }, id: null }, {
        status: 401,
        headers: { "WWW-Authenticate": `Bearer resource_metadata="${new URL(request.url).origin}/.well-known/oauth-protected-resource/mcp", error="invalid_token"` },
      });
    }
    return handler.fetch(request, {
      authInfo: {
        token: "",
        clientId,
        scopes: String(claims.scope ?? "").split(" ").filter(Boolean),
        extra: { userId: claims.sub },
      },
    });
  },
  { resource: MCP_RESOURCE },
);

export { protectedHandler as GET, protectedHandler as POST, protectedHandler as DELETE };
