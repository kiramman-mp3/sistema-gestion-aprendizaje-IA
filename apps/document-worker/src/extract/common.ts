/** Recibe el avance del trabajo, de 0 a 100. */
export type ProgressReporter = (percent: number) => void | Promise<void>;

/** Unicode normalizado (NFC), sin caracteres de control y con espacios simples. */
export function normalizeText(text: string): string {
  return (
    text
      .normalize("NFC")
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f­]/g, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}
