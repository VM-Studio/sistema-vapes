import { SearchX } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function NotFound() {
  return (
    <main className="bg-background flex min-h-dvh items-center justify-center p-4">
      <EmptyState
        icon={SearchX}
        title="No encontramos esta página"
        description="Puede que el enlace esté mal o que el registro ya no exista."
        action={
          <Link href="/" className={buttonVariants({ variant: "secondary" })}>
            Ir al inicio
          </Link>
        }
        className="w-full max-w-md"
      />
    </main>
  );
}
