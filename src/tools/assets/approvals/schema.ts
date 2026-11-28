// The owner approval log, assets/approvals.json (mw-e37.3, style bible §16–17). One record per gate
// decision: which file version was approved or rejected, by whom, and the file's SHA-256, so CI can
// refuse a final asset whose committed file is not the one that was approved.
import { z } from 'zod';
import { jsonErrorOffset, lineColumn } from './json-location.ts';
import requiredGatesJson from './required-gates.json' with { type: 'json' };

export const GATES = ['image', 'turntable', 'music-take', 'sfx-batch'] as const;
export type Gate = (typeof GATES)[number];

/** Asset id = filename stem: lower-kebab-case ASCII, ≤ 64 chars (style bible §15.1). */
export const ASSET_ID = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;

/** Gates each CREDITS type requires (required-gates.json), checked on load. */
const gatesByType: Record<string, Gate[]> = z
  .record(z.string(), z.union([z.string(), z.array(z.enum(GATES))]))
  .transform((table) =>
    Object.fromEntries(Object.entries(table).filter((e): e is [string, Gate[]] => Array.isArray(e[1]))),
  )
  .parse(requiredGatesJson);
export const REQUIRED_GATES: Readonly<Record<string, readonly Gate[] | undefined>> = gatesByType;

export const approvalRecord = z.strictObject({
  assetId: z.string().max(64).regex(ASSET_ID, 'asset id must be lower-kebab-case'),
  gate: z.enum(GATES),
  version: z.string().regex(/^v[1-9]\d*$/, 'version must look like v1, v2, …'),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'sha256 must be 64 lowercase hex digits'),
  decision: z.enum(['approved', 'rejected']),
  approver: z
    .string()
    .min(1)
    .refine((s) => !s.includes('@'), 'approver is a name or handle, never an email'),
  date: z.iso.datetime(),
  /** Repo-relative path of the file that was hashed (an assets/_incoming candidate or a committed file). */
  file: z.string().min(1),
  note: z.string(),
});
export type ApprovalRecord = z.infer<typeof approvalRecord>;

export const approvalsFile = z.strictObject({
  $comment: z.string().optional(),
  records: z.array(approvalRecord),
});
export type ApprovalsFile = z.infer<typeof approvalsFile>;

/** Parses approvals.json text; throws with the JSON position or the failing record field. */
export function parseApprovals(text: string, path: string): ApprovalsFile {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    const where = lineColumn(text, jsonErrorOffset(text));
    throw new Error(`${path}: ${where}: ${(error as Error).message}`, { cause: error });
  }
  const result = approvalsFile.safeParse(json);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const where = issue.path
        .map((key) => (typeof key === 'number' ? `[${String(key)}]` : `.${String(key)}`))
        .join('')
        .replace(/^\./, '');
      return `${path}: ${where || '(root)'}: ${issue.message}`;
    });
    throw new Error(issues.join('\n'));
  }
  return result.data;
}

export function serializeApprovals(file: ApprovalsFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}
