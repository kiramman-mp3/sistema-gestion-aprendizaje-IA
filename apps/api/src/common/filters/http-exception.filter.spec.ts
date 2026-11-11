import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  HttpException,
} from "@nestjs/common";
import { HttpExceptionFilter } from "./http-exception.filter";

function mockHost() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const setHeader = jest.fn();
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status, setHeader }) }),
  } as unknown as ArgumentsHost;
  return { host, status, json, setHeader };
}

describe("HttpExceptionFilter", () => {
  const filter = new HttpExceptionFilter();

  it("usa un código por defecto según el estado HTTP", () => {
    const { host, status, json } = mockHost();
    filter.catch(new ForbiddenException("Sin permiso sobre el curso."), host);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({
      code: "FORBIDDEN",
      message: "Sin permiso sobre el curso.",
    });
  });

  it("conserva un código y detalles propios", () => {
    const { host, json } = mockHost();
    filter.catch(
      new HttpException(
        {
          code: "FORBIDDEN_COURSE",
          message: "Curso ajeno.",
          details: [{ path: "courseId", message: "x" }],
        },
        403,
      ),
      host,
    );

    expect(json).toHaveBeenCalledWith({
      code: "FORBIDDEN_COURSE",
      message: "Curso ajeno.",
      details: [{ path: "courseId", message: "x" }],
    });
  });

  it("une mensajes múltiples de validación", () => {
    const { host, json } = mockHost();
    filter.catch(new BadRequestException(["campo a", "campo b"]), host);

    expect(json).toHaveBeenCalledWith({ code: "VALIDATION_ERROR", message: "campo a; campo b" });
  });

  it("oculta los detalles de errores no controlados", () => {
    const { host, status, json } = mockHost();
    jest.spyOn(filter["logger"], "error").mockImplementation(() => undefined);
    filter.catch(new Error("detalle interno con secreto"), host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      code: "INTERNAL_ERROR",
      message: "Error interno del servidor.",
    });
  });

  it("envía Retry-After cuando la excepción lo pide", () => {
    const { host, status, setHeader } = mockHost();
    const exception = Object.assign(
      new HttpException({ code: "RATE_LIMITED", message: "Límite de uso." }, 429),
      { retryAfterSeconds: 90.2 },
    );

    filter.catch(exception, host);

    expect(setHeader).toHaveBeenCalledWith("Retry-After", "91");
    expect(status).toHaveBeenCalledWith(429);
  });

  it("no envía Retry-After si la excepción no lo pide", () => {
    const { host, setHeader } = mockHost();

    filter.catch(new ForbiddenException("x"), host);

    expect(setHeader).not.toHaveBeenCalled();
  });
});
