import { z } from "zod";

/**
 * Reglas de las señales de dificultad (RF-16, CU-06). Cada regla tiene parámetros con valores por defecto;
 * una regla de un curso reemplaza a la institucional del mismo tipo (`moodleCourseId` nulo), y sin ninguna
 * se usa el valor por defecto de este archivo. Un parámetro guardado que no cumple el esquema se descarta y
 * se usan los de por defecto: una regla mal configurada no deja al docente sin señales ni rompe la analítica.
 */
export const DIFFICULTY_RULE_TYPES = [
  "MISSING_REQUIRED",
  "GRADE_BELOW_THRESHOLD",
  "SUSTAINED_DECLINE",
  "REPEATED_OUTCOME_DIFFICULTY",
] as const;
export type DifficultyRuleType = (typeof DIFFICULTY_RULE_TYPES)[number];

/** Ventana opcional en días: solo cuentan las actividades vencidas o calificadas en ese periodo. */
const windowDays = z.number().int().positive().max(365).optional();
const percent = z.number().min(0).max(100);

export const ruleParamsSchemas = {
  /** Tareas vencidas sin entrega. `requiredCmids` limita la regla a esas actividades. */
  MISSING_REQUIRED: z.strictObject({
    minMissing: z.number().int().positive().default(2),
    requiredCmids: z.array(z.number().int().positive()).max(100).optional(),
    windowDays,
  }),
  /** Notas por debajo de un porcentaje de la nota máxima. */
  GRADE_BELOW_THRESHOLD: z.strictObject({
    thresholdPercent: percent.default(60),
    minActivities: z.number().int().positive().default(2),
    windowDays,
  }),
  /** Notas consecutivas, cada una menor que la anterior. */
  SUSTAINED_DECLINE: z.strictObject({
    consecutive: z.number().int().min(3).max(10).default(3),
    windowDays,
  }),
  /** Notas bajas en actividades relacionadas con un mismo resultado de aprendizaje. */
  REPEATED_OUTCOME_DIFFICULTY: z.strictObject({
    thresholdPercent: percent.default(60),
    minActivities: z.number().int().positive().default(2),
    windowDays,
  }),
} as const satisfies Record<DifficultyRuleType, z.ZodType>;

export type RuleParams<T extends DifficultyRuleType> = z.infer<(typeof ruleParamsSchemas)[T]>;

export interface RuleConfig<T extends DifficultyRuleType = DifficultyRuleType> {
  rule: T;
  enabled: boolean;
  params: RuleParams<T>;
}

/** Fila de `difficulty_rules` tal como la entrega la base. */
export interface StoredRule {
  rule: DifficultyRuleType;
  moodleCourseId: number | null;
  enabled: boolean;
  params: unknown;
}

export function defaultRules(): RuleConfig[] {
  return DIFFICULTY_RULE_TYPES.map((rule) => ({
    rule,
    enabled: true,
    params: ruleParamsSchemas[rule].parse({}),
  })) as RuleConfig[];
}

/**
 * Reglas efectivas de un curso: para cada tipo, la del curso si existe, si no la institucional, si no la
 * de por defecto.
 */
export function resolveRules(stored: StoredRule[], courseId: number): RuleConfig[] {
  return DIFFICULTY_RULE_TYPES.map((rule) => {
    const row =
      stored.find((r) => r.rule === rule && r.moodleCourseId === courseId) ??
      stored.find((r) => r.rule === rule && r.moodleCourseId === null);
    const defaults = ruleParamsSchemas[rule].parse({});
    if (!row) return { rule, enabled: true, params: defaults } as RuleConfig;
    const parsed = ruleParamsSchemas[rule].safeParse(row.params ?? {});
    return {
      rule,
      enabled: row.enabled,
      params: parsed.success ? parsed.data : defaults,
    } as RuleConfig;
  });
}
