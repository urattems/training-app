const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Chemins des clés présentes dans le JSON brut mais absentes du résultat validé :
 * des champs inconnus du contrat, ignorés à l'import. Une clé à `null` n'est pas
 * signalée (aucune information perdue, ex. `targetRepsMin: null`).
 */
export function findIgnoredFields(raw: unknown, parsed: unknown, path = ''): string[] {
  if (Array.isArray(raw) && Array.isArray(parsed)) {
    return raw.flatMap((item, i) => findIgnoredFields(item, parsed[i], `${path}[${String(i)}]`));
  }
  if (!isPlainObject(raw) || !isPlainObject(parsed)) return [];
  return Object.entries(raw).flatMap(([key, value]) => {
    const childPath = path === '' ? key : `${path}.${key}`;
    if (!(key in parsed)) return value === null ? [] : [childPath];
    return findIgnoredFields(value, parsed[key], childPath);
  });
}

/** Noms de clés ignorées, uniques et triés, pour l'affichage (« champs ignorés : color, style »). */
export function ignoredFieldNames(paths: readonly string[]): string[] {
  const names = paths.map((p) => p.replace(/\[\d+\]/g, '').split('.').at(-1) ?? p);
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}
