import { z } from "zod";

/**
 * Validador de lenguaje de las recomendaciones pedagógicas (RF-18). El sistema describe hechos
 * observables y propone estrategias; no diagnostica, no etiqueta y no emite juicios sobre la
 * persona. Una recomendación que contenga estos términos se rechaza y no llega al docente.
 *
 * Es una barrera determinista y deliberadamente estricta: ante la duda, rechaza. La lista se ajusta
 * con la revisión pedagógica del piloto.
 */
export type ViolationKind = "diagnosis" | "label" | "judgement";

interface Rule {
  kind: ViolationKind;
  term: string;
  pattern: RegExp;
}

function rule(kind: ViolationKind, term: string, pattern: string): Rule {
  return { kind, term, pattern: new RegExp(`(?<![\\p{L}])(?:${pattern})(?![\\p{L}])`, "iu") };
}

const RULES: Rule[] = [
  // Diagnósticos clínicos o del aprendizaje
  rule("diagnosis", "dislexia", "dislexi[ac]\\w*|disl[eé]xic[oa]s?"),
  rule("diagnosis", "discalculia", "discalculi[ac]\\w*"),
  rule("diagnosis", "TDAH", "tdah|tda|d[eé]ficit\\s+de\\s+atenci[oó]n|hiperactiv\\w+"),
  rule("diagnosis", "autismo", "autis(?:mo|ta|tas)|asperger"),
  rule("diagnosis", "depresión", "depresi[oó]n|deprimid[oa]s?|depresiv[oa]s?"),
  rule("diagnosis", "ansiedad", "ansiedad|ansios[oa]s?|trastorno\\s+de\\s+ansiedad"),
  rule(
    "diagnosis",
    "trastorno",
    "trastornos?|s[ií]ndromes?|patolog[ií]as?|enfermedad(?:es)?\\s+mental(?:es)?",
  ),
  rule("diagnosis", "discapacidad", "discapacidad(?:es)?|discapacitad[oa]s?|retraso\\s+mental"),
  rule("diagnosis", "coeficiente intelectual", "coeficiente\\s+intelectual|c\\.?\\s?i\\.?\\s+bajo"),
  // "Evaluación diagnóstica" es un término pedagógico legítimo: solo se rechaza el diagnóstico de personas.
  rule(
    "diagnosis",
    "diagnóstico",
    "diagnostic(?:ar|ad[oa]s?|[oó])|diagn[oó]stico\\s+(?:de|cl[ií]nico|m[eé]dico|psicol[oó]gico)",
  ),
  // Etiquetas sobre la persona
  rule("label", "vago", "vag[oa]s?|hol[gz]az[aá]n(?:es|a|as)?|flojo|floja|flojos|flojas"),
  rule("label", "perezoso", "perezos[oa]s?|desidios[oa]s?|apátic[oa]s?|apatic[oa]s?"),
  rule("label", "irresponsable", "irresponsables?|desinteresad[oa]s?|desmotivad[oa]s?"),
  rule("label", "problemático", "problem[aá]tic[oa]s?|conflictiv[oa]s?|rebelde|rebeldes"),
  // Juicios sobre la capacidad o el carácter
  rule("judgement", "incapaz", "incapa(?:z|ces)|in[uú]til(?:es)?|torpe|torpes|tont[oa]s?"),
  rule(
    "judgement",
    "poca inteligencia",
    "poca\\s+inteligencia|baja\\s+inteligencia|no\\s+es\\s+inteligente",
  ),
  rule("judgement", "no sirve", "no\\s+sirve\\s+para|no\\s+tiene\\s+capacidad|sin\\s+capacidad"),
  rule("judgement", "fracaso", "fracasad[oa]s?|perdedor(?:a|es|as)?|caso\\s+perdido"),
];

export interface LanguageViolation {
  /** Ruta del campo donde se encontró, por ejemplo `strategies[1]`. */
  path: string;
  kind: ViolationKind;
  term: string;
}

/** Forma compuesta (NFC), para que una tilde escrita con marca combinada coincida con los patrones. */
function plain(text: string): string {
  return text.normalize("NFC");
}

/** Revisa un texto y devuelve los términos prohibidos que contiene. */
export function findLanguageViolations(text: string, path = "text"): LanguageViolation[] {
  const source = plain(text);
  const found: LanguageViolation[] = [];
  for (const { kind, term, pattern } of RULES) {
    if (pattern.test(source)) found.push({ path, kind, term });
  }
  return found;
}

/** Campos de texto de una recomendación (`components/schemas/Recommendation`) que el modelo redacta. */
export const recommendationContentSchema = z.object({
  evidenceSummary: z.array(z.string()),
  strengths: z.array(z.string()).default([]),
  difficulties: z.array(z.string()).default([]),
  missingInformation: z.array(z.string()),
  strategies: z.array(z.string()),
  reinforcementActivities: z.array(z.string()).default([]),
  followUpIndicators: z.array(z.string()),
});
export type RecommendationContent = z.infer<typeof recommendationContentSchema>;

/** Revisa todos los campos de una recomendación. Una lista vacía significa que el lenguaje es aceptable. */
export function validateRecommendationLanguage(
  content: RecommendationContent,
): LanguageViolation[] {
  const violations: LanguageViolation[] = [];
  for (const [field, values] of Object.entries(content) as [string, string[]][]) {
    values.forEach((value, index) => {
      violations.push(...findLanguageViolations(value, `${field}[${index}]`));
    });
  }
  return violations;
}
