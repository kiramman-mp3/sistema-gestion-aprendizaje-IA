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
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
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
});
