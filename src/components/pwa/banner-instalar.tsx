"use client";

import { Download, Share, SquarePlus, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

/**
 * Prompt de instalación propio: aparece recién desde el SEGUNDO login (el
 * primero es para conocer la app), discreto, con "Instalar" y "Ahora no"
 * (se recuerda 14 días). En iOS no existe `beforeinstallprompt`: se muestran
 * las instrucciones "Compartir → Agregar a inicio".
 */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export const CLAVE_LOGINS = "pwa.logins";
const CLAVE_DESCARTE = "pwa.instalar.descartadoHasta";
const CATORCE_DIAS = 14 * 24 * 3600 * 1000;

export function registrarLogin(): void {
  try {
    localStorage.setItem(CLAVE_LOGINS, String(Number(localStorage.getItem(CLAVE_LOGINS) ?? 0) + 1));
  } catch {
    /* sin almacenamiento */
  }
}

const esStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;
const esIos = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent);

function corresponde(): boolean {
  try {
    if (esStandalone()) return false;
    if (Number(localStorage.getItem(CLAVE_LOGINS) ?? 0) < 2) return false;
    return Date.now() > Number(localStorage.getItem(CLAVE_DESCARTE) ?? 0);
  } catch {
    return false;
  }
}

export function BannerInstalar() {
  const [evento, setEvento] = useState<BeforeInstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [instrucciones, setInstrucciones] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const capturar = (e: Event) => {
      e.preventDefault(); // sin el mini-infobar del navegador: mostramos el nuestro
      setEvento(e as BeforeInstallPromptEvent);
      if (corresponde()) setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", capturar);
    const instalada = () => setVisible(false);
    window.addEventListener("appinstalled", instalada);
    if (esIos() && corresponde()) {
      setIos(true);
      setVisible(true);
    }
    return () => {
      window.removeEventListener("beforeinstallprompt", capturar);
      window.removeEventListener("appinstalled", instalada);
    };
  }, []);

  function ahoraNo() {
    try {
      localStorage.setItem(CLAVE_DESCARTE, String(Date.now() + CATORCE_DIAS));
    } catch {
      /* sin almacenamiento */
    }
    setVisible(false);
  }

  async function instalar() {
    if (ios) return setInstrucciones(true);
    if (!evento) return;
    await evento.prompt();
    const { outcome } = await evento.userChoice;
    if (outcome === "dismissed") ahoraNo();
    else setVisible(false);
    setEvento(null);
  }

  if (!visible) return null;
  return (
    <>
      <aside
        aria-label="Instalar la app"
        data-testid="banner-instalar"
        className="border-border bg-surface rounded-card shadow-pop fixed inset-x-3 top-[calc(4rem+env(safe-area-inset-top))] z-40 flex items-center gap-3 border p-3 md:inset-x-auto md:top-auto md:right-6 md:bottom-6 md:max-w-md"
      >
        <span className="bg-card text-foreground rounded-control flex size-10 shrink-0 items-center justify-center">
          <Download className="size-5" strokeWidth={1.75} aria-hidden />
        </span>
        <p className="min-w-0 flex-1 text-sm">
          <strong className="block">Instalá la app</strong>
          <span className="text-muted">
            Abrila desde el inicio del celular, como cualquier app.
          </span>
        </p>
        <Button size="sm" onClick={instalar}>
          Instalar
        </Button>
        <Button size="sm" variant="ghost" onClick={ahoraNo} aria-label="Ahora no">
          <X strokeWidth={1.75} />
        </Button>
      </aside>
      <Dialog
        open={instrucciones}
        onOpenChange={setInstrucciones}
        title="Instalar en iPhone"
        description="Safari no tiene botón de instalar: se agrega desde Compartir."
      >
        <ol className="flex flex-col gap-4 text-sm">
          <li className="flex items-center gap-3">
            <span className="bg-surface rounded-control flex size-10 shrink-0 items-center justify-center">
              <Share className="text-foreground size-5" strokeWidth={1.75} aria-hidden />
            </span>
            <span>
              1. Tocá <strong>Compartir</strong> (el cuadrado con la flecha, abajo en Safari).
            </span>
          </li>
          <li className="flex items-center gap-3">
            <span className="bg-surface rounded-control flex size-10 shrink-0 items-center justify-center">
              <SquarePlus className="text-foreground size-5" strokeWidth={1.75} aria-hidden />
            </span>
            <span>
              2. Elegí <strong>Agregar a inicio</strong> y tocá <strong>Agregar</strong>.
            </span>
          </li>
        </ol>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/ios-agregar-a-inicio.svg"
          alt="Compartir → Agregar a inicio en Safari"
          className="border-border bg-surface rounded-card mt-2 w-full border"
        />
      </Dialog>
    </>
  );
}
