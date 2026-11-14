import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Auth, type AuthContext } from "../auth/auth-context";
import type { ExtractionVersionDto } from "./extraction/extraction.dto";
import { SyllabusExtractionService } from "./extraction/syllabus-extraction.service";
import { MAX_SYLLABUS_BYTES, SyllabiService, type UploadedDocument } from "./syllabi.service";
import type { SyllabusDocumentDto } from "./syllabus.dto";

@Controller("syllabi")
export class SyllabiController {
  constructor(
    private readonly syllabi: SyllabiService,
    private readonly extractions: SyllabusExtractionService,
  ) {}

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

  /** El sílabo más reciente del curso, para retomarlo al abrir la página (antes que `:syllabusId`). */
  @Get("latest")
  latest(@Auth() auth: AuthContext): Promise<SyllabusDocumentDto> {
    return this.syllabi.latest(auth);
  }

  /** Estado y progreso del procesamiento (RF-04). */
  @Get(":syllabusId")
  findOne(
    @Auth() auth: AuthContext,
    @Param("syllabusId") id: string,
  ): Promise<SyllabusDocumentDto> {
    return this.syllabi.findOne(auth, id);
  }

  /**
   * Descarta el sílabo y todo lo que el asistente generó con él (extracciones y propuestas sin publicar).
   * Lo publicado en Moodle no se toca: si hay algo publicado, responde 409.
   */
  @Delete(":syllabusId")
  @HttpCode(HttpStatus.NO_CONTENT)
  discard(@Auth() auth: AuthContext, @Param("syllabusId") id: string): Promise<void> {
    return this.syllabi.discard(auth, id);
  }

  /** Inicia o reintenta la extracción con IA (RF-05). Responde al instante; el avance se consulta con GET. */
  @Post(":syllabusId/extract")
  @HttpCode(HttpStatus.ACCEPTED)
  extract(
    @Auth() auth: AuthContext,
    @Param("syllabusId") id: string,
  ): Promise<SyllabusDocumentDto> {
    return this.extractions.start(auth, id);
  }

  /** Última versión de la extracción, o la indicada con `?version=`. */
  @Get(":syllabusId/extraction")
  extraction(
    @Auth() auth: AuthContext,
    @Param("syllabusId") id: string,
    @Query("version") version: string | undefined,
  ): Promise<ExtractionVersionDto> {
    return this.extractions.get(auth, id, parseVersion(version));
  }

  /** Guarda la revisión del docente como versión nueva y deja el sílabo en `REVIEWED` (RF-06). */
  @Put(":syllabusId/extraction")
  @HttpCode(HttpStatus.CREATED)
  saveRevision(
    @Auth() auth: AuthContext,
    @Param("syllabusId") id: string,
    @Body() body: unknown,
  ): Promise<ExtractionVersionDto> {
    return this.extractions.saveRevision(auth, id, body);
  }
}

/** Una versión ausente o inválida pide la última. */
function parseVersion(value: string | undefined): number | undefined {
  return value !== undefined && /^[1-9]\d{0,8}$/.test(value) ? Number(value) : undefined;
}

/** Un valor ausente o no numérico se trata como otro curso: el servicio responde 403. */
function parseCourseId(value: string | undefined): number {
  return value !== undefined && /^\d+$/.test(value) ? Number(value) : Number.NaN;
}
