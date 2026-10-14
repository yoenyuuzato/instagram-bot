import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-semibold">IG Bot</h1>
      <p className="text-sm text-neutral-600">Automatické odpovědi na komentáře a zprávy na Instagramu.</p>
      <Link href="/admin" className="btn">
        Do administrace
      </Link>
    </main>
  );
}
