import { Store } from "lucide-react";
import type { Metadata } from "next";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Ingresar" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="bg-primary text-primary-foreground flex size-12 items-center justify-center rounded-2xl">
          <Store className="size-6" aria-hidden />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Ingresar</h1>
          <p className="text-muted text-sm">Usá tu email y contraseña</p>
        </div>
      </div>
      <div className="border-border bg-surface rounded-2xl border p-5 shadow-sm">
        <LoginForm next={next} />
      </div>
    </div>
  );
}
