import { LoginForm } from "./LoginForm";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-5">
      <h1 className="text-center text-3xl font-bold">Gad English</h1>
      <LoginForm next={typeof next === "string" ? next : "/"} />
    </main>
  );
}
