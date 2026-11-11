import type { SyllabusExtraction, UncertainField } from "@smart-lms/contracts";

const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

/** Minúsculas, sin tildes y con espacios simples, para comparar texto sin que el formato estorbe. */
export function normalize(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Números que aparecen en el texto, por ejemplo `20`, `12,5` o `12.5` (como `12.5`). */
function numbersIn(text: string): Set<number> {
  const found = new Set<number>();
  for (const match of text.matchAll(/\d+(?:[.,]\d+)?/g)) {
    found.add(Number(match[0].replace(",", ".")));
  }
  return found;
}

/** Formas en que un sílabo puede escribir una fecha ISO `AAAA-MM-DD`. */
function dateSpellings(iso: string): RegExp[] {
  const [year, month, day] = iso.split("-").map(Number) as [number, number, number];
  const d = String(day);
  const dd = d.padStart(2, "0");
  const m = String(month);
  const mm = m.padStart(2, "0");
  const name = MONTHS[month - 1] ?? "";
  const sep = "[/.\\-]";
  return [
    new RegExp(`\\b${year}-${mm}-${dd}\\b`),
    new RegExp(`\\b0?${d}${sep}0?${m}${sep}${year}\\b`),
    new RegExp(`\\b${year}${sep}0?${m}${sep}0?${d}\\b`),
    new RegExp(`\\b0?${d} (?:de )?${name}(?: (?:de|del) ${year})?\\b`),
    new RegExp(`\\b${name} 0?${d}(?:,? (?:de |del )?${year})?\\b`),
  ];
}

export interface GroundingResult {
  extraction: SyllabusExtraction;
  /** Datos descartados por no encontrarse en el documento; también quedan en `uncertainFields`. */
  dropped: { path: string; value: string }[];
}

/**
 * Última defensa contra datos inventados (sección 6.2 de los requisitos). Una fecha o una ponderación
 * que el modelo devuelve pero que no aparece escrita en el documento se anula (`null`) y se marca
 * como incierta para que la revise el docente. Las citas con página inexistente o fragmento que no
 * está en el texto pierden ese dato en vez de quedar como respaldo falso.
 *
 * La comprobación es deliberadamente permisiva con el formato (`04/12/2026`, `4 de diciembre`,
 * `12,5`) y estricta con el contenido: prefiere pedir revisión antes que aceptar un dato sin origen.
 */
export function groundExtraction(
  extraction: SyllabusExtraction,
  sourceText: string,
  pageCount: number | null,
): GroundingResult {
  const text = normalize(sourceText);
  const numbers = numbersIn(sourceText);
  const dropped: GroundingResult["dropped"] = [];
  const uncertain: UncertainField[] = [...extraction.uncertainFields];
  const alreadyUncertain = new Set(uncertain.map((field) => field.path));

  const flag = (path: string, value: string, note: string): void => {
    dropped.push({ path, value });
    if (alreadyUncertain.has(path)) return;
    alreadyUncertain.add(path);
    uncertain.push({ path, reason: "low_confidence", note });
  };

  const checkWeight = (value: number | null, path: string): number | null => {
    if (value === null || numbers.has(value)) return value;
    flag(path, String(value), "La ponderación no aparece en el documento y se dejó vacía.");
    return null;
  };

  const checkDate = (value: string | null, path: string): string | null => {
    if (value === null || dateSpellings(value).some((pattern) => pattern.test(text))) return value;
    flag(path, value, "La fecha no aparece escrita en el documento y se dejó vacía.");
    return null;
  };

  const result: SyllabusExtraction = {
    ...extraction,
    gradingPeriods: extraction.gradingPeriods.map((period, p) => ({
      ...period,
      weight: checkWeight(period.weight, `gradingPeriods[${p}].weight`),
      units: period.units.map((unit, u) => {
        const base = `gradingPeriods[${p}].units[${u}]`;
        return {
          ...unit,
          startDate: checkDate(unit.startDate, `${base}.startDate`),
          endDate: checkDate(unit.endDate, `${base}.endDate`),
          activities: unit.activities.map((activity, a) => {
            const at = `${base}.activities[${a}]`;
            return {
              ...activity,
              suggestedDueDate: checkDate(activity.suggestedDueDate, `${at}.suggestedDueDate`),
              weight: checkWeight(activity.weight, `${at}.weight`),
            };
          }),
        };
      }),
    })),
    assessmentInstruments: extraction.assessmentInstruments.map((instrument, i) => ({
      ...instrument,
      weight: checkWeight(instrument.weight, `assessmentInstruments[${i}].weight`),
    })),
    sourceReferences: extraction.sourceReferences.map((reference) => ({
      ...reference,
      page:
        reference.page !== null && pageCount !== null && reference.page > pageCount
          ? null
          : reference.page,
      excerpt:
        reference.excerpt !== null && !text.includes(normalize(reference.excerpt))
          ? null
          : reference.excerpt,
    })),
    uncertainFields: uncertain,
  };

  return { extraction: result, dropped };
}
