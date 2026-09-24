-- AlterTable
ALTER TABLE "Usuario" ADD COLUMN     "debeCambiarPassword" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "IntentoLogin" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "ip" TEXT,
    "exitoso" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntentoLogin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IntentoLogin_email_createdAt_idx" ON "IntentoLogin"("email", "createdAt");

-- CreateIndex
CREATE INDEX "IntentoLogin_ip_createdAt_idx" ON "IntentoLogin"("ip", "createdAt");


-- =============================================================================
-- A mano: reglas de auth/permisos que la DB puede garantizar.
-- =============================================================================

-- El rate limit cuenta por email normalizado: la DB no acepta otra forma.
ALTER TABLE "IntentoLogin"
  ADD CONSTRAINT "IntentoLogin_email_chk" CHECK ("email" = lower(btrim("email")));

-- Un intento registrado es un hecho: no se edita (sí se puede purgar lo viejo).
CREATE TRIGGER trg_intento_login_inmutable
  BEFORE UPDATE ON "IntentoLogin"
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

-- Crear/editar/eliminar sin poder ver el módulo no tiene sentido.
ALTER TABLE "PermisoUsuario"
  ADD CONSTRAINT "PermisoUsuario_ver_chk" CHECK (
    "puedeVer" OR NOT ("puedeCrear" OR "puedeEditar" OR "puedeEliminar")
  );

-- Nunca puede quedar el sistema sin un OWNER activo.
-- Diferido al COMMIT; el advisory lock serializa cambios concurrentes
-- (dos dueños degradándose mutuamente a la vez no pueden pasar los dos).
CREATE OR REPLACE FUNCTION fn_verificar_owner_activo() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('usuarios:owner_activo'));
  IF NOT EXISTS (
    SELECT 1 FROM "Usuario"
    WHERE "rol" = 'OWNER' AND "activo" AND "deletedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'Debe quedar al menos un dueño (OWNER) activo'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_usuario_owner_activo
  AFTER UPDATE OF "rol", "activo", "deletedAt" ON "Usuario"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_owner_activo();
