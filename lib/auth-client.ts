import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { createAuthClient } from "better-auth/react";

// The plugin forwards the signed OAuth query from the login/consent page URL, so the flow resumes.
export const authClient = createAuthClient({ plugins: [oauthProviderClient()] });
