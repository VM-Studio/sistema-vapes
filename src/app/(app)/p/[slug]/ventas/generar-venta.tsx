"use client";

import { Modulo } from "@prisma/client";
import { History, Plus } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { usePanel } from "@/components/layout/panel-context";
import { usePuede, useUsuario } from "@/components/layout/usuario-context";
import { Button } from "@/components/ui/button";

import {
  claveVentaEnCurso,
  leerVentaEnCurso,
  ventaTieneDatos,
  ventaVacia,
  type VentaEnCurso,
} from "./estado-venta";
import { ModalVenta, type ConversionVenta, type DepositoVenta } from "./modal-venta";

/**
 * Botón principal "Generar venta" (+ "Retomar venta en curso" si quedó una
 * guardada) y el modal. `?nueva=1` lo abre al cargar (con `deposito` y el
 * cliente preseleccionados si vienen: links desde otros módulos). Con
 * `conversion` abre la conversión de esa cotización (ítems y cliente bloqueados).
 */
export function GenerarVenta({
  depositos,
  unidades,
  puedeEditar,
  abrirAlCargar,
  conversion,
}: {
  depositos: DepositoVenta[];
  unidades: Record<string, number>;
  puedeEditar: boolean;
  abrirAlCargar: {
    depositoId: string | null;
    cliente: { id: string; nombre: string; telefono: string } | null;
  } | null;
  conversion: ConversionVenta | null;
}) {
  const { slug } = usePanel();
  const usuario = useUsuario();
  const puedeAltaProductos = usePuede(Modulo.PRODUCTOS, "crear");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const clave = claveVentaEnCurso(slug, usuario.id);
  const [guardada, setGuardada] = useState<VentaEnCurso | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [inicial, setInicial] = useState<VentaEnCurso>(() => ventaVacia());
  const [convirtiendo, setConvirtiendo] = useState<ConversionVenta | null>(null);

  const principal = depositos.find((d) => d.esPrincipal)?.id ?? null;

  useEffect(() => {
    setGuardada(leerVentaEnCurso(clave));
  }, [clave, abierto]);

  useEffect(() => {
    if (conversion) {
      setConvirtiendo(conversion);
      setInicial({
        ...ventaVacia(principal),
        items: conversion.items,
        cliente: conversion.cliente,
        descuento: conversion.descuento,
      });
      setAbierto(true);
      const params = new URLSearchParams(searchParams.toString());
      for (const k of ["nueva", "cotizacion", "recalcular"]) params.delete(k);
      router.replace(params.size ? `${pathname}?${params}` : pathname, { scroll: false });
      return;
    }
    if (!abrirAlCargar) return;
    const depositoId = depositos.some((d) => d.id === abrirAlCargar.depositoId)
      ? abrirAlCargar.depositoId
      : null;
    setInicial({
      ...ventaVacia(depositoId ?? principal),
      paso: depositoId ? "productos" : "galpon",
      cliente: abrirAlCargar.cliente ? { tipo: "existente", ...abrirAlCargar.cliente } : null,
    });
    setAbierto(true);
    // Que recargar la página no vuelva a abrir el modal.
    const params = new URLSearchParams(searchParams.toString());
    for (const k of ["nueva", "deposito", "cliente"]) params.delete(k);
    router.replace(params.size ? `${pathname}?${params}` : pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al montar
  }, []);

  const hayGuardada = guardada !== null && ventaTieneDatos(guardada);

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {hayGuardada && (
          <Button
            variant="secondary"
            size="lg"
            onClick={() => {
              setConvirtiendo(null);
              setInicial(guardada);
              setAbierto(true);
            }}
          >
            <History strokeWidth={1.75} /> Retomar venta en curso ({guardada.items.length})
          </Button>
        )}
        <Button
          size="lg"
          onClick={() => {
            setConvirtiendo(null);
            setInicial(ventaVacia(principal));
            setAbierto(true);
          }}
        >
          <Plus strokeWidth={1.75} /> Generar venta
        </Button>
      </div>
      <ModalVenta
        abierto={abierto}
        inicial={inicial}
        depositos={depositos}
        unidadesIniciales={unidades}
        puedeEditar={puedeEditar}
        puedeAltaProductos={puedeAltaProductos}
        claveStorage={clave}
        conversion={convirtiendo}
        onCerrado={() => {
          setAbierto(false);
          setConvirtiendo(null);
        }}
      />
    </>
  );
}
