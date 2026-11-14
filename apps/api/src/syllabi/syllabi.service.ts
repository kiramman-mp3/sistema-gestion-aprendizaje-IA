import { createHash } from "node:crypto";
import {
  Logger,
  BadRequestException,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AntivirusUnavailableError } from "../antivirus/clamav.client";
import { AntivirusService } from "../antivirus/antivirus.service";
import { AuditService } from "../audit/audit.service";
import type { AuthContext } from "../auth/auth-context";
import type { Env } from "../config/env";
import { PrismaService } from "../database/prisma.service";
import { IntegrationAccountService } from "../integrations/integration-account.service";
import { FileStorage } from "../storage/file-storage";
import {
  detectDocumentKind,
  DOCUMENT_MIME_TYPES,
  FileRejectedError,
  type DocumentKind,
} from "./file-signature";
import { SyllabusProcessingService } from "./syllabus-processing.service";
import { toSyllabusDto, type SyllabusDocumentDto } from "./syllabus.dto";

/** RF-03 y RNF-04: sílabos de hasta 10 MB. */
export const MAX_SYLLABUS_BYTES = 10 * 1024 * 1024;

/** Archivo recibido por multer, en memoria. */
export interface UploadedDocument {
  originalname: string;
  buffer: Buffer;
  size: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Estados de una propuesta que ya tocó Moodle: `FAILED` es una publicación que se cortó a mitad y pudo dejar
 * elementos creados. Un sílabo con una propuesta así no se descarta.
 */
const PUBLISHED_STATUSES = ["PUBLISHING", "PUBLISHED", "FAILED"] as const;

/** Se detectó una propuesta publicada dentro de la transacción del descarte. */
class SyllabusPublishedError extends Error {}

@Injectable()
export class SyllabiService {
  private readonly logger = new Logger(SyllabiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FileStorage,
    private readonly antivirus: AntivirusService,
    private readonly audit: AuditService,
    private readonly accounts: IntegrationAccountService,
    private readonly config: ConfigService<Env, true>,
    private readonly processing: SyllabusProcessingService,
  ) {}

  /**
   * Valida, analiza y guarda un sílabo. El orden va de lo más barato a lo más caro, y nada se escribe
   * en disco ni en la base hasta que el archivo pasó todas las validaciones.
   */
  async upload(
    auth: AuthContext,
    courseId: number,
    file: UploadedDocument | undefined,
  ): Promise<SyllabusDocumentDto> {
    if (courseId !== auth.courseId) {
      throw new ForbiddenException({
        code: "FORBIDDEN_COURSE",
        message: "El token no corresponde a este curso.",
      });
    }
    if (!file || file.size === 0) {
      throw new BadRequestException({
        code: "FILE_REQUIRED",
        message: "Adjunta el sílabo en el campo file.",
      });
    }

    const kind = await this.checkType(auth, file);
    const checksum = createHash("sha256").update(file.buffer).digest("hex");

    const duplicate = await this.prisma.syllabusDocument.findFirst({
      where: {
        moodleCourseId: courseId,
        checksumSha256: checksum,
        status: { notIn: ["REJECTED", "FAILED"] },
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException({
        code: "DUPLICATE_SYLLABUS",
        message: "Este archivo ya se cargó en el curso.",
        details: [{ path: "syllabusId", message: duplicate.id }],
      });
    }

    await this.scan(auth, file);

    const storageKey = await this.storage.put("syllabi", kind, file.buffer);
    const retentionDays = this.config.get("SYLLABUS_RETENTION_DAYS", { infer: true });
    const document = await this.prisma.syllabusDocument
      .create({
        data: {
          integrationAccountId: await this.accounts.currentId(),
          moodleCourseId: courseId,
          uploadedBy: auth.moodleUserId,
          filename: cleanFilename(file.originalname, kind),
          mimeType: DOCUMENT_MIME_TYPES[kind],
          sizeBytes: file.size,
          checksumSha256: checksum,
          storageKey,
          retainUntil: new Date(Date.now() + retentionDays * DAY_MS),
        },
      })
      .catch(async (error: unknown) => {
        // Sin fila que lo referencie, el archivo quedaría huérfano hasta siempre.
        await this.storage.delete(storageKey);
        throw error;
      });

    await this.audit.record({
      action: "syllabus.upload",
      outcome: "SUCCESS",
      actorMoodleId: auth.moodleUserId,
      courseId,
      resourceType: "syllabus_document",
      resourceId: document.id,
      metadata: { kind, sizeBytes: file.size },
    });
    const enqueued = await this.processing.enqueue({ documentId: document.id, storageKey, kind });
    return toSyllabusDto(enqueued ? { ...document, status: "PROCESSING" } : document, {
      progress: enqueued ? 0 : null,
    });
  }

  /**
   * El sílabo del curso del token con la actividad más reciente, para que la página lo retome al abrirse sin que
   * el docente tenga que recordar su id. Responde 404 si el curso no tiene ninguno.
   */
  async latest(auth: AuthContext): Promise<SyllabusDocumentDto> {
    const latest = await this.prisma.syllabusDocument.findFirst({
      where: { moodleCourseId: auth.courseId },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    if (!latest) {
      throw new NotFoundException({
        code: "SYLLABUS_NOT_FOUND",
        message: "El curso no tiene sílabos.",
      });
    }
    return this.findOne(auth, latest.id);
  }

  /**
   * Estado de un sílabo del curso del token. Un sílabo de otro curso responde 404, igual que uno que
   * no existe, para no revelar que existe (RF-02).
   */
  async findOne(auth: AuthContext, id: string): Promise<SyllabusDocumentDto> {
    const document = /^[0-9a-f-]{36}$/i.test(id)
      ? await this.prisma.syllabusDocument.findUnique({
          where: { id },
          select: {
            id: true,
            moodleCourseId: true,
            filename: true,
            status: true,
            errorCode: true,
            createdAt: true,
            pageCount: true,
            extractedText: true,
            extractions: { select: { version: true }, orderBy: { version: "desc" }, take: 1 },
          },
        })
      : null;
    if (!document || document.moodleCourseId !== auth.courseId) {
      throw new NotFoundException({ code: "SYLLABUS_NOT_FOUND", message: "El sílabo no existe." });
    }
    const progress =
      document.status === "PROCESSING"
        ? ((await this.processing.progress(document.id)) ?? 0)
        : document.status === "UPLOADED"
          ? 0
          : 100;
    return toSyllabusDto(document, {
      progress,
      latestExtractionVersion: document.extractions[0]?.version ?? null,
    });
  }

  /**
   * Descarta lo que generó el asistente a partir de un sílabo: el documento, su texto, sus fragmentos para
   * la búsqueda, todas las versiones de la extracción y las propuestas sin publicar. No toca el curso de
   * Moodle, así que se niega (409) si alguna propuesta del sílabo ya se publicó o empezó a publicarse.
   * Borrar propuestas exige `publish`, la misma capacidad que crearlas.
   */
  async discard(auth: AuthContext, id: string): Promise<void> {
    const document = /^[0-9a-f-]{36}$/i.test(id)
      ? await this.prisma.syllabusDocument.findUnique({
          where: { id },
          select: {
            id: true,
            moodleCourseId: true,
            storageKey: true,
            _count: { select: { extractions: true } },
          },
        })
      : null;
    if (!document || document.moodleCourseId !== auth.courseId) {
      throw new NotFoundException({ code: "SYLLABUS_NOT_FOUND", message: "El sílabo no existe." });
    }

    const proposals = { extraction: { documentId: document.id } };
    const proposalCount = await this.prisma.courseProposal.count({ where: proposals });
    if (proposalCount > 0 && !auth.capabilities?.publish) {
      await this.audit.record({
        action: "access.denied",
        outcome: "DENIED",
        actorMoodleId: auth.moodleUserId,
        courseId: auth.courseId,
        resourceType: "syllabus_document",
        resourceId: document.id,
        metadata: { code: "FORBIDDEN_CAPABILITY", operation: "syllabus.discard" },
      });
      throw new ForbiddenException({
        code: "FORBIDDEN_CAPABILITY",
        message: "Falta la capacidad: publish.",
      });
    }

    await this.prisma
      .$transaction(async (tx) => {
        // La comprobación va dentro de la transacción: una publicación que empezó entre tanto deja una
        // operación que impide borrar la propuesta, y el descarte se cancela entero.
        const published = await tx.courseProposal.count({
          where: {
            ...proposals,
            OR: [
              { status: { in: [...PUBLISHED_STATUSES] } },
              { publishOperations: { some: {} } },
            ],
          },
        });
        if (published > 0) throw new SyllabusPublishedError();
        // Los elementos de cada propuesta, las extracciones y los fragmentos se borran en cascada.
        await tx.courseProposal.deleteMany({ where: proposals });
        await tx.syllabusDocument.delete({ where: { id: document.id } });
      })
      .catch((error: unknown) => {
        if (error instanceof SyllabusPublishedError || isForeignKeyViolation(error)) {
          throw new ConflictException({
            code: "SYLLABUS_PUBLISHED",
            message:
              "Una propuesta de este sílabo ya se publicó en Moodle; lo publicado no se descarta desde aquí.",
          });
        }
        throw error;
      });

    if (document.storageKey) {
      // La fila ya no existe: si el archivo no se puede borrar, lo dice el registro, pero el descarte vale.
      await this.storage.delete(document.storageKey).catch(() => {
        this.logger.error(`No se pudo borrar el archivo del sílabo descartado ${document.id}.`);
      });
    }
    await this.audit.record({
      action: "syllabus.discard",
      outcome: "SUCCESS",
      actorMoodleId: auth.moodleUserId,
      courseId: auth.courseId,
      resourceType: "syllabus_document",
      resourceId: document.id,
      metadata: { extractions: document._count.extractions, proposals: proposalCount },
    });
  }

  private async checkType(auth: AuthContext, file: UploadedDocument): Promise<DocumentKind> {
    try {
      return detectDocumentKind(file.originalname, file.buffer);
    } catch (error) {
      if (!(error instanceof FileRejectedError)) throw error;
      await this.reject(auth, error.code);
      throw new UnsupportedMediaTypeException({ code: error.code, message: error.message });
    }
  }

  private async scan(auth: AuthContext, file: UploadedDocument): Promise<void> {
    let verdict;
    try {
      verdict = await this.antivirus.scan(file.buffer);
    } catch (error) {
      if (!(error instanceof AntivirusUnavailableError)) throw error;
      // Falla cerrado: sin análisis no se acepta el archivo.
      throw new ServiceUnavailableException({
        code: "ANTIVIRUS_UNAVAILABLE",
        message: "No se pudo analizar el archivo. Inténtalo de nuevo en unos minutos.",
      });
    }
    if (verdict.status === "infected") {
      await this.reject(auth, "MALWARE_DETECTED", { signature: verdict.signature });
      throw new HttpException(
        {
          code: "MALWARE_DETECTED",
          message: "El antivirus detectó contenido malicioso en el archivo.",
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
  }

  private reject(
    auth: AuthContext,
    reason: string,
    extra: Record<string, string> = {},
  ): Promise<void> {
    return this.audit.record({
      action: "syllabus.rejected",
      outcome: "DENIED",
      actorMoodleId: auth.moodleUserId,
      courseId: auth.courseId,
      resourceType: "syllabus_document",
      metadata: { reason, ...extra },
    });
  }
}

/** Prisma P2003: una fila que se iba a borrar sigue referenciada (una operación de publicación nueva). */
function isForeignKeyViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2003";
}

/**
 * Nombre que se muestra al docente. Se quitan rutas y caracteres de control; el archivo en disco
 * nunca usa este nombre.
 */
export function cleanFilename(original: string, kind: DocumentKind): string {
  const base = original.normalize("NFC").split(/[/\\]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return clean.length > 0 ? clean.slice(-255) : `silabo.${kind}`;
}
