"use client";

import { DatabaseBackup, Download } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

import { backupAhoraAction, descargarBackupAction } from "./actions";

export function BotonBackup() {
  const router = useRouter();
  const toast = useToast();
  const [cargando, setCargando] = useState(false);
  return (
    <Button
      loading={cargando}
      onClick={async () => {
        setCargando(true);
        const r = await backupAhoraAction();
        setCargando(false);
        if (!r.ok) return toast.error("No se pudo hacer el backup", r.error.message);
        if (!r.data.ok) return toast.error("El backup falló", r.data.error);
        toast.success(
          "Backup hecho y verificado",
          `${(r.data.tamanio / 1024).toFixed(0)} KB · ${r.data.entradas} entradas`,
        );
        router.refresh();
      }}
    >
      <DatabaseBackup strokeWidth={1.75} /> Hacer backup ahora
    </Button>
  );
}

export function BotonDescargar({ id }: { id: string }) {
  const toast = useToast();
  return (
    <Button
      size="sm"
      variant="secondary"
      onClick={async () => {
        const r = await descargarBackupAction({ id });
        if (!r.ok) return toast.error("No se pudo descargar", r.error.message);
        window.location.assign(r.data.url);
      }}
    >
      <Download strokeWidth={1.75} /> Descargar
    </Button>
  );
}
