export default function Home() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-2xl font-semibold">Sistema de Gestión</h1>
      <p className="text-sm text-neutral-500">
        Capa de datos lista. Estado de la base:{" "}
        <a className="underline" href="/api/health">
          /api/health
        </a>
      </p>
    </main>
  );
}
