/**
 * Errores del cliente de Moodle. Ninguno incluye el token ni la URL con parámetros, para que se puedan
 * registrar sin filtrar secretos (SEC-09).
 */
export class MoodleError extends Error {
  constructor(
    message: string,
    readonly wsfunction: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Moodle respondió con una excepción de negocio (`{ exception, errorcode, message }`). */
export class MoodleApiError extends MoodleError {
  constructor(
    wsfunction: string,
    readonly errorcode: string,
    message: string,
  ) {
    super(`${wsfunction}: ${errorcode}: ${message}`, wsfunction);
  }
}

/** Token inválido, expirado o sin acceso al servicio. */
export class MoodleAuthError extends MoodleApiError {}

/** El usuario de integración no tiene la capacidad necesaria. */
export class MoodlePermissionError extends MoodleApiError {}

/** Moodle no respondió, respondió 5xx o excedió el tiempo límite. */
export class MoodleUnavailableError extends MoodleError {}

/** La respuesta no tiene la forma esperada. */
export class MoodleResponseError extends MoodleError {}

const AUTH_CODES = new Set(["invalidtoken", "accessexception", "servicerequireslogin"]);
const PERMISSION_CODES = new Set([
  "nopermissions",
  "requireloginerror",
  "notingroup",
  "errorcoursecontextnotvalid",
]);

export function toMoodleApiError(
  wsfunction: string,
  errorcode: string,
  message: string,
): MoodleApiError {
  if (AUTH_CODES.has(errorcode)) return new MoodleAuthError(wsfunction, errorcode, message);
  if (PERMISSION_CODES.has(errorcode)) {
    return new MoodlePermissionError(wsfunction, errorcode, message);
  }
  return new MoodleApiError(wsfunction, errorcode, message);
}
