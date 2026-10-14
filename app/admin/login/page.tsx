import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata = { title: "Přihlášení · IG Bot" };

async function Form({ searchParams }: { searchParams: PageProps<"/admin/login">["searchParams"] }) {
  const { next } = await searchParams;
  return <LoginForm next={typeof next === "string" ? next : "/admin"} />;
}

export default function LoginPage({ searchParams }: PageProps<"/admin/login">) {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="card w-full max-w-sm">
        <h1 className="mb-1 text-lg font-semibold">IG Bot · administrace</h1>
        <p className="mb-5 text-sm text-neutral-500">Zadejte heslo pro vstup.</p>
        <Suspense fallback={<LoginForm next="/admin" />}>
          <Form searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}
