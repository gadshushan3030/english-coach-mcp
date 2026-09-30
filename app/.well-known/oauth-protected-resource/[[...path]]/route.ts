import { auth } from "@/lib/auth";

// RFC 9728 metadata for /mcp, served by the mcp() plugin.
export const GET = (request: Request) => auth.handler(request);
