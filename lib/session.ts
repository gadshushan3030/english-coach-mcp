import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth, isAllowedEmail } from "@/lib/auth";

// The signed-in owner's user id; anyone else goes to /login.
export const requireOwner = cache(async () => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !isAllowedEmail(session.user.email)) redirect("/login");
  return session.user.id;
});
