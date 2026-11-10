import { buildSyllabusExtraction } from "@smart-lms/contracts";

/**
 * Base de datos en memoria con lo justo que usa ProposalsService. Reproduce las consultas exactas
 * del servicio; si el servicio cambia de consulta, esta clase debe cambiar con él.
 */

export interface StoredDocument {
  id: string;
  moodleCourseId: number;
  status: string;
  checksumSha256: string;
}
export interface StoredExtraction {
  id: string;
  documentId: string;
  version: number;
  content: unknown;
}
export interface StoredProposal {
  id: string;
  extractionId: string;
  moodleCourseId: number;
  createdBy: number;
  status: string;
  approvedBy: number | null;
  approvedAt: Date | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
export interface StoredItem {
  id: string;
  proposalId: string;
  parentId: string | null;
  itemType: string;
  title: string;
  description: string | null;
  position: number;
  unitRef: string;
  learningOutcomeIds: string[];
  dueDate: Date | null;
  weight: number | null;
  moodleItemId: number | null;
  publishStatus: string;
  publishError: string | null;
}

export interface StoredOperation {
  id: string;
  proposalId: string;
  idempotencyKey: string;
  requestedBy: number;
  status: string;
  createdCount: number;
  failedCount: number;
  createdAt: Date;
  finishedAt: Date | null;
}

export const DOC_ID = "d0000000-0000-4000-8000-000000000001";
export const OTHER_COURSE_DOC_ID = "d0000000-0000-4000-8000-000000000002";
export const UNREVIEWED_DOC_ID = "d0000000-0000-4000-8000-000000000003";

export class ProposalsStore {
  documents: StoredDocument[] = [];
  extractions: StoredExtraction[] = [];
  proposals: StoredProposal[] = [];
  items: StoredItem[] = [];
  operations: StoredOperation[] = [];
  /** Hace que la próxima `updateMany` no encuentre filas, como si otra petición se hubiera adelantado. */
  loseNextRace = false;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.documents = [
      { id: DOC_ID, moodleCourseId: 7, status: "REVIEWED", checksumSha256: "a".repeat(64) },
      {
        id: OTHER_COURSE_DOC_ID,
        moodleCourseId: 8,
        status: "REVIEWED",
        checksumSha256: "b".repeat(64),
      },
      {
        id: UNREVIEWED_DOC_ID,
        moodleCourseId: 7,
        status: "EXTRACTED",
        checksumSha256: "c".repeat(64),
      },
    ];
    this.extractions = this.documents.flatMap((document, i) => [
      {
        id: `e0000000-0000-4000-8000-00000000000${i + 1}`,
        documentId: document.id,
        version: 1,
        content: buildSyllabusExtraction(),
      },
    ]);
    this.proposals = [];
    this.items = [];
    this.operations = [];
    this.loseNextRace = false;
  }

  /** Objeto que reemplaza a `PrismaService` en las pruebas. */
  prisma() {
    const clone = <T>(value: T): T => structuredClone(value);
    const extractionOf = (id: string) => this.extractions.find((e) => e.id === id)!;
    const documentOf = (extractionId: string) =>
      this.documents.find((d) => d.id === extractionOf(extractionId).documentId)!;

    const tables = {
      syllabusDocument: {
        findUnique: async ({ where }: { where: { id: string } }) =>
          clone(this.documents.find((d) => d.id === where.id) ?? null),
      },
      syllabusExtraction: {
        findUnique: async ({
          where,
        }: {
          where: { documentId_version: { documentId: string; version: number } };
        }) =>
          clone(
            this.extractions.find(
              (e) =>
                e.documentId === where.documentId_version.documentId &&
                e.version === where.documentId_version.version,
            ) ?? null,
          ),
      },
      courseProposal: {
        findFirst: async ({
          where,
        }: {
          where: {
            moodleCourseId: number;
            status: { not: string };
            extraction: { document: { checksumSha256: string } };
          };
        }) =>
          clone(
            this.proposals.find(
              (p) =>
                p.moodleCourseId === where.moodleCourseId &&
                p.status !== where.status.not &&
                documentOf(p.extractionId).checksumSha256 ===
                  where.extraction.document.checksumSha256,
            ) ?? null,
          ),
        create: async ({ data }: { data: Partial<StoredProposal> & { id: string } }) => {
          const proposal = {
            approvedBy: null,
            approvedAt: null,
            publishedAt: null,
            createdAt: new Date("2026-11-09T12:00:00Z"),
            updatedAt: new Date("2026-11-09T12:00:00Z"),
            ...data,
          } as StoredProposal;
          this.proposals.push(proposal);
          return clone(proposal);
        },
        update: async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<StoredProposal>;
        }) => {
          const proposal = this.proposals.find((p) => p.id === where.id)!;
          Object.assign(proposal, data);
          return clone(proposal);
        },
        updateMany: async ({
          where,
          data,
        }: {
          where: { id: string; status: string };
          data: Partial<StoredProposal>;
        }) => {
          if (this.loseNextRace) {
            this.loseNextRace = false;
            return { count: 0 };
          }
          const proposal = this.proposals.find(
            (p) => p.id === where.id && p.status === where.status,
          );
          if (!proposal) return { count: 0 };
          Object.assign(proposal, data);
          return { count: 1 };
        },
        findUnique: async ({ where }: { where: { id: string } }) => {
          const proposal = this.proposals.find((p) => p.id === where.id);
          if (!proposal) return null;
          const extraction = extractionOf(proposal.extractionId);
          return clone({
            ...proposal,
            items: this.items
              .filter((item) => item.proposalId === proposal.id)
              .sort((a, b) => a.position - b.position),
            extraction: { version: extraction.version, documentId: extraction.documentId },
            publishOperations: this.operations
              .filter((operation) => operation.proposalId === proposal.id)
              .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
              .slice(0, 1)
              .map((operation) => ({ id: operation.id, status: operation.status })),
          });
        },
      },
      publishOperation: {
        findUnique: async ({
          where,
          include,
        }: {
          where: { id?: string; idempotencyKey?: string };
          include?: { proposal?: unknown };
        }) => {
          const operation = this.operations.find((o) =>
            where.id !== undefined ? o.id === where.id : o.idempotencyKey === where.idempotencyKey,
          );
          if (!operation) return null;
          if (!include?.proposal) return clone(operation);
          const proposal = this.proposals.find((p) => p.id === operation.proposalId)!;
          const items = this.items
            .filter((item) => item.proposalId === proposal.id)
            .sort((a, b) => a.position - b.position);
          return clone({ ...operation, proposal: { ...proposal, items } });
        },
        create: async ({
          data,
        }: {
          data: Partial<StoredOperation> & { idempotencyKey: string };
        }) => {
          if (this.operations.some((o) => o.idempotencyKey === data.idempotencyKey)) {
            throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
          }
          const operation = {
            status: "RUNNING",
            createdCount: 0,
            failedCount: 0,
            // Un segundo más por operación, para que "la más reciente" tenga sentido.
            createdAt: new Date(Date.UTC(2026, 10, 9, 12, 0, this.operations.length)),
            finishedAt: null,
            ...data,
          } as StoredOperation;
          this.operations.push(operation);
          return clone(operation);
        },
        update: async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<StoredOperation>;
        }) => {
          const operation = this.operations.find((o) => o.id === where.id)!;
          Object.assign(operation, data);
          return clone(operation);
        },
      },
      proposalItem: {
        update: async ({ where, data }: { where: { id: string }; data: Partial<StoredItem> }) => {
          const item = this.items.find((i) => i.id === where.id)!;
          Object.assign(item, data);
          return clone(item);
        },
        updateMany: async ({
          where,
          data,
        }: {
          where: { proposalId: string; publishStatus: string };
          data: Partial<StoredItem>;
        }) => {
          const matching = this.items.filter(
            (i) => i.proposalId === where.proposalId && i.publishStatus === where.publishStatus,
          );
          for (const item of matching) Object.assign(item, data);
          return { count: matching.length };
        },
        createMany: async ({ data }: { data: Partial<StoredItem>[] }) => {
          for (const row of data) {
            this.items.push({
              description: null,
              moodleItemId: null,
              publishStatus: "PENDING",
              publishError: null,
              ...row,
            } as StoredItem);
          }
          return { count: data.length };
        },
        deleteMany: async ({ where }: { where: { proposalId: string } }) => {
          const before = this.items.length;
          this.items = this.items.filter((item) => item.proposalId !== where.proposalId);
          return { count: before - this.items.length };
        },
        findMany: async ({
          where,
        }: {
          where: { id: { in: string[] }; proposalId: { not: string } };
        }) =>
          clone(
            this.items
              .filter(
                (item) => where.id.in.includes(item.id) && item.proposalId !== where.proposalId.not,
              )
              .map((item) => ({ id: item.id })),
          ),
      },
    };
    return {
      ...tables,
      $transaction: async <T>(work: (tx: typeof tables) => Promise<T>) => work(tables),
    };
  }
}
