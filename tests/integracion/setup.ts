import { prepararBaseDeTest } from "../../e2e/global-setup";

export const URL_VITEST =
  process.env.DATABASE_URL_TEST_VITEST ??
  "postgresql://app:app@localhost:5433/gestion_test_vitest?schema=public";

/** Base aislada, desde cero (migrate deploy + seed), antes de los tests de integración. */
export default async function setup() {
  await prepararBaseDeTest(URL_VITEST);
}
