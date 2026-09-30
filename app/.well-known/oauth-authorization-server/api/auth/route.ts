import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import { auth } from "@/lib/auth";

// RFC 8414 path-insertion form for the issuer <origin>/api/auth.
export const GET = oauthProviderAuthServerMetadata(auth);
