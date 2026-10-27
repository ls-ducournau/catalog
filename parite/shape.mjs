// Forme d'une réponse JSON, sans les valeurs : le contrat que v1 (TypeScript) et v2 (Rust) doivent
// respecter. Deux serveurs sur des données différentes donnent la même forme.
// spec: specs/catalog-v2-rust-supabase.md (FR-7, AC-6)

/** « string », « number », « boolean », « null », ["array", forme], ou { clé: forme }. */
export function shape(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return ["array", value.length === 0 ? "vide" : merge(value.map(shape))];
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, shape(v)]));
  return typeof value;
}

/** Fusionne les formes des éléments d'une liste : une clé absente de certains devient facultative. */
function merge(shapes) {
  return shapes.reduce((a, b) => union(a, b));
}

function union(a, b) {
  if (a === "null") return b;
  if (b === "null") return a;
  if (a === "vide") return b;
  if (b === "vide") return a;
  if (Array.isArray(a) && Array.isArray(b)) return ["array", union(a[1], b[1])];
  if (isObject(a) && isObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return Object.fromEntries([...keys].sort().map((k) => [k, k in a && k in b ? union(a[k], b[k]) : k in a ? a[k] : b[k]]));
  }
  return a === b ? a : `${a}|${b}`;
}

const isObject = (x) => x !== null && typeof x === "object" && !Array.isArray(x);

/** Champs de la v1 que la v2 n'a plus (FR-1) : leur absence n'est pas un écart. */
export const RETIRES_EN_V2 = new Set(["notionPageId", "notionLastEdited", "localDirty"]);

/** Liste les écarts entre la forme attendue et la forme reçue ; vide si elles concordent. */
export function diff(expected, actual, path = "$", { v2 = false } = {}) {
  if (expected === "null" || actual === "null" || expected === "vide" || actual === "vide") return [];
  if (typeof expected === "string" && typeof actual === "string") {
    const accepted = new Set(expected.split("|"));
    return actual.split("|").every((t) => accepted.has(t)) ? [] : [`${path} : attendu ${expected}, reçu ${actual}`];
  }
  if (Array.isArray(expected) && Array.isArray(actual)) return diff(expected[1], actual[1], `${path}[]`, { v2 });
  if (isObject(expected) && isObject(actual)) {
    const out = [];
    for (const k of Object.keys(expected)) {
      if (!(k in actual)) {
        if (!(v2 && RETIRES_EN_V2.has(k))) out.push(`${path}.${k} : clé absente`);
      } else out.push(...diff(expected[k], actual[k], `${path}.${k}`, { v2 }));
    }
    for (const k of Object.keys(actual)) if (!(k in expected)) out.push(`${path}.${k} : clé en trop`);
    return out;
  }
  return [`${path} : attendu ${JSON.stringify(expected)}, reçu ${JSON.stringify(actual)}`];
}
