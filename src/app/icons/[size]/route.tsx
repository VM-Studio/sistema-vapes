import { renderAppIcon } from "@/lib/app-icon";

/** /icons/192, /icons/512 y /icons/maskable (512, con zona segura) para el manifest. */
const TAMANOS = {
  "192": { size: 192, maskable: false },
  "512": { size: 512, maskable: false },
  maskable: { size: 512, maskable: true },
} as const;

export const dynamic = "force-static";

export function generateStaticParams() {
  return Object.keys(TAMANOS).map((size) => ({ size }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size } = await params;
  const conf = TAMANOS[size as keyof typeof TAMANOS];
  if (!conf) return new Response("Not found", { status: 404 });
  return renderAppIcon(conf.size, { maskable: conf.maskable });
}
