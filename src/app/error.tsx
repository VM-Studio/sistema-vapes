"use client";

import { TriangleAlert } from "lucide-react";
import Link from "next/link";

import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

/** Error inesperado en una pantalla: mismo estilo que los estados vacíos. */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[60dvh] items-center justify-center p-4">
      <EmptyState
        icon={TriangleAlert}
        title="Algo salió mal"
        description={
          <>
            No pudimos mostrar esta pantalla. Probá de nuevo; si sigue pasando, avisale a un dueño
            {error.digest ? (
              <>
                {" "}
                con este código: <span className="text-foreground font-mono">{error.digest}</span>
              </>
            ) : null}
            .
          </>
        }
        action={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Button onClick={reset}>Reintentar</Button>
            <Link href="/" className={buttonVariants({ variant: "secondary" })}>
              Ir al inicio
            </Link>
          </div>
        }
        className="w-full max-w-md"
      />
    </div>
  );
}
