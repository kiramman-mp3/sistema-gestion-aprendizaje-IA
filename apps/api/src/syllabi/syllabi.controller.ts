import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Auth, type AuthContext } from "../auth/auth-context";
import { MAX_SYLLABUS_BYTES, SyllabiService, type UploadedDocument } from "./syllabi.service";
import type { SyllabusDocumentDto } from "./syllabus.dto";

@Controller("syllabi")
export class SyllabiController {
  constructor(private readonly syllabi: SyllabiService) {}

  /**
   * Carga un sílabo (RF-03). Los guards verifican el token y los permisos antes de leer el cuerpo,
   * así que una petición sin permiso no llega a subir el archivo.
   */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(
    // Sin `storage` ni `dest`, multer guarda el archivo en memoria: nada toca el disco antes de validarlo.
    FileInterceptor("file", {
      // Multer responde 413 si se supera el tamaño; el resto limita campos para evitar abusos.
      limits: { fileSize: MAX_SYLLABUS_BYTES, files: 1, fields: 5, parts: 6 },
      // Sin esto, busboy interpreta los nombres de archivo como latin1 y "Sílabo" se corrompe.
      defParamCharset: "utf8",
    }),
  )
  upload(
    @Auth() auth: AuthContext,
    @Body("courseId") courseId: string | undefined,
    @UploadedFile() file: UploadedDocument | undefined,
  ): Promise<SyllabusDocumentDto> {
    return this.syllabi.upload(auth, parseCourseId(courseId), file);
  }
}

/** Un valor ausente o no numérico se trata como otro curso: el servicio responde 403. */
function parseCourseId(value: string | undefined): number {
  return value !== undefined && /^\d+$/.test(value) ? Number(value) : Number.NaN;
}
