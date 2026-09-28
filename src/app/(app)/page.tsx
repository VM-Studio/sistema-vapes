import { redirect } from "next/navigation";

/** La app arranca en el selector de sistemas (que redirige solo si hay uno). */
export default function Inicio() {
  redirect("/paneles");
}
