/**
 * Dependencia externa cuyo estado se informa en `GET /health`. Cada módulo que dependa de un
 * servicio (base de datos, Redis, Moodle) registra su indicador en `HealthService` al iniciar.
 */
export interface HealthIndicator {
  readonly name: string;
  /** Debe resolver `true` si la dependencia responde. Si lanza, se considera caída. */
  isHealthy(): Promise<boolean>;
}
