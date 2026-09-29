/** searchParams de Next → objeto plano de strings (los arrays se ignoran). */
export async function paramsPlanos(
  sp: Promise<Record<string, string | string[] | undefined>>,
): Promise<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(await sp).filter((e): e is [string, string] => typeof e[1] === "string"),
  );
}
