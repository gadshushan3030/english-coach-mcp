// RFC 9728 metadata: tells MCP clients that /mcp is protected by the Supabase OAuth server.
// Served at both /.well-known/oauth-protected-resource and /.well-known/oauth-protected-resource/mcp.
export function GET(request: Request) {
  const origin = new URL(request.url).origin;
  return Response.json({
    resource: `${origin}/mcp`,
    authorization_servers: [`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`],
    bearer_methods_supported: ["header"],
    resource_name: "Gad English",
  });
}
