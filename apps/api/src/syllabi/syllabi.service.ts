import { createHash } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
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

@Injectable()
export class SyllabiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FileStorage,
    private readonly antivirus: AntivirusService,
    private readonly audit: AuditService,
    private readonly accounts: IntegrationAccountService,
    private readonly config: ConfigService<Env, true>,
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
    return toSyllabusDto(document);
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
