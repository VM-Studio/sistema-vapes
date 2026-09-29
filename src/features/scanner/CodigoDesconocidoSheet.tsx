"use client";

import { Modulo } from "@prisma/client";
import { Link2, PackagePlus } from "lucide-react";
import { useState } from "react";

import { agregarCodigoAlternativoAction } from "@/app/(app)/p/[slug]/productos/actions";
import { VariantePicker, type VarianteBuscada } from "@/components/catalogo/variante-picker";
import { usePuede } from "@/components/layout/usuario-context";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";

import { resolverVarianteAction } from "./actions";
import { invalidarResoluciones } from "./resolver-codigo";
import type { VarianteEscaneada } from "./tipos";

/**
 * "Este código no existe": asociarlo a un sabor existente (queda como código
 * alternativo) o darlo de alta (alta rápida, con el código precargado). Sin
 * permiso para ninguna de las dos, solo se avisa.
 */
export function CodigoDesconocidoSheet({
  codigo,
  onClose,
  onAsociado,
  onCrear,
}: {
  codigo: string | null;
  onClose: () => void;
  onAsociado: (v: VarianteEscaneada) => void;
  /** Abre el alta rápida con este código. */
  onCrear: (codigo: string) => void;
}) {
  const toast = useToast();
  const puedeAsociar = usePuede(Modulo.PRODUCTOS, "editar");
  const creaProductos = usePuede(Modulo.PRODUCTOS, "crear");
  const creaCompras = usePuede(Modulo.COMPRAS, "crear");
  const puedeCrear = creaProductos || creaCompras;
  const [elegida, setElegida] = useState<VarianteBuscada | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string>();

  function cerrar() {
    setElegida(null);
    setError(undefined);
    onClose();
  }

  async function asociar() {
    if (!codigo || !elegida) return;
    setEnviando(true);
    const r = await agregarCodigoAlternativoAction({
      varianteId: elegida.varianteId,
      codigo,
      descripcion: "Asociado desde el escáner",
    });
    if (!r.ok) {
      setEnviando(false);
      setError(r.error.fields?.codigo?.[0] ?? r.error.message);
      return;
    }
    invalidarResoluciones(codigo);
    const v = await resolverVarianteAction({ varianteId: elegida.varianteId });
    setEnviando(false);
    toast.success(`Código ${codigo} asociado`, elegida.titulo);
    if (v.ok && v.data) onAsociado(v.data);
    cerrar();
  }

  return (
    <Sheet
      open={codigo !== null}
      onOpenChange={(o) => !o && cerrar()}
      title="Este código no existe"
      description={codigo ? `No hay ningún producto con el código ${codigo}.` : undefined}
      footer={
        puedeAsociar ? (
          <>
            <Button variant="secondary" onClick={cerrar} disabled={enviando}>
              Cancelar
            </Button>
            <Button onClick={asociar} loading={enviando} disabled={!elegida}>
              <Link2 /> Asociar
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={cerrar}>
            Entendido
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-5">
        {!puedeAsociar && !puedeCrear && (
          <p className="bg-warning-soft text-warning-soft-foreground rounded-control px-3 py-2.5 text-sm">
            No tenés permiso para cargar productos. Pedile a alguien con permiso en Productos que lo
            agregue.
          </p>
        )}
        {puedeAsociar && (
          <section className="flex flex-col gap-2">
            <h3 className="font-medium">Asociar a un producto existente</h3>
            <p className="text-muted text-sm">
              Por ejemplo, el mismo producto que llegó de otro importador con otro código.
            </p>
            {elegida ? (
              <div className="border-foreground bg-surface rounded-control flex items-center justify-between gap-2 border px-3 py-2.5 text-sm">
                <span className="font-medium">{elegida.titulo}</span>
                <Button variant="ghost" size="sm" onClick={() => setElegida(null)}>
                  Cambiar
                </Button>
              </div>
            ) : (
              <VariantePicker onSelect={setElegida} placeholder="Buscar el producto…" autoFocus />
            )}
            {error && (
              <p className="text-danger text-sm" role="alert">
                {error}
              </p>
            )}
          </section>
        )}
        {puedeCrear && (
          <section className="border-border flex flex-col gap-2 border-t pt-4">
            <h3 className="font-medium">¿Es un producto nuevo?</h3>
            <Button variant="secondary" onClick={() => codigo && onCrear(codigo)}>
              <PackagePlus strokeWidth={1.75} /> Crear producto con este código
            </Button>
          </section>
        )}
      </div>
    </Sheet>
  );
}
