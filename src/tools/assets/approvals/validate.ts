// The approvals rule of assets:validate (mw-e37.3): every non-placeholder runtime asset under
// public/assets/ needs an approved record for each gate its CREDITS type requires, and the committed
// file that record points at must still hash to an approved version (style bible §16–17).
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { findCredit, type CreditRow } from './credits.ts';
import type { ApprovalRecord, Gate } from './schema.ts';

export const RUNTIME_ROOT = 'public/assets';
export const INCOMING_ROOT = 'assets/_incoming';
export const SOURCE_ROOT = 'assets/source';

/** One runtime asset: every file under public/assets/ that shares an id (stem), sidecar JSON aside. */
export interface RuntimeAsset {
  assetId: string;
  files: string[];
}

export interface ApprovalEnv {
  assets: readonly RuntimeAsset[];
  credits: readonly CreditRow[];
  records: readonly ApprovalRecord[];
  requiredGates: Readonly<Record<string, readonly Gate[] | undefined>>;
  /** Repo-relative path of the committed file a record covers, or undefined when there is none. */
  committedFile(record: ApprovalRecord): string | undefined;
  /** SHA-256 (hex) of a repo-relative file. */
  hashOf(path: string): string;
}

export interface ApprovalReport {
  problems: string[];
  placeholders: number;
  finals: number;
}

function checkGate(env: ApprovalEnv, assetId: string, type: string, gate: Gate): string | undefined {
  const records = env.records.filter((r) => r.assetId === assetId && r.gate === gate);
  const latest = records.filter((r) => r.decision === 'approved').at(-1);
  if (latest === undefined) {
    return `${assetId}: missing approval for gate "${gate}" (required for type "${type}")`;
  }
  const path = env.committedFile(latest);
  if (path === undefined) {
    return `${assetId}: the approved ${gate} ${latest.version} file is not committed (${latest.file}); promote it to ${SOURCE_ROOT}/<category>/${assetId}/`;
  }
  const actual = env.hashOf(path);
  const decision = records.filter((r) => r.sha256 === actual).at(-1);
  if (decision?.decision === 'approved') return undefined;
  if (decision !== undefined) {
    return `${assetId}: ${path} is the rejected ${gate} ${decision.version}`;
  }
  return `${assetId}: approval stale for gate "${gate}": ${path} has sha256 ${actual}, approved ${latest.version} has sha256 ${latest.sha256}`;
}

/** Checks every runtime asset; placeholders (CREDITS `placeholder: yes`) need no approval. */
export function validateApprovals(env: ApprovalEnv): ApprovalReport {
  const report: ApprovalReport = { problems: [], placeholders: 0, finals: 0 };
  for (const asset of env.assets) {
    const credit = findCredit(env.credits, asset.assetId);
    if (credit === undefined) {
      report.problems.push(
        `${asset.assetId}: no assets/CREDITS.md row, so its approvals cannot be checked (${asset.files.join(', ')})`,
      );
      continue;
    }
    if (credit.placeholder) {
      report.placeholders++;
      continue;
    }
    report.finals++;
    const gates = env.requiredGates[credit.type];
    if (gates === undefined) {
      report.problems.push(
        `${asset.assetId}: CREDITS type "${credit.type}" (line ${String(credit.line)}) has no entry in required-gates.json`,
      );
      continue;
    }
    for (const gate of gates) {
      const problem = checkGate(env, asset.assetId, credit.type, gate);
      if (problem !== undefined) report.problems.push(problem);
    }
  }
  return report;
}

// --- Filesystem side -------------------------------------------------------------------------------

export const sha256File = (path: string): string =>
  createHash('sha256').update(readFileSync(path)).digest('hex');

function walk(root: string, dir: string): string[] {
  const absolute = join(root, dir);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute)
    .sort()
    .flatMap((name) => {
      const path = `${dir}/${name}`;
      return statSync(join(root, path)).isDirectory() ? walk(root, path) : [path];
    });
}

/** Runtime assets grouped by id; `.json` sidecars (loop points, manifests) are not assets. */
export function listRuntimeAssets(root: string): RuntimeAsset[] {
  const byId = new Map<string, string[]>();
  for (const path of walk(root, RUNTIME_ROOT)) {
    const ext = extname(path);
    if (ext === '.json') continue;
    const id = basename(path, ext);
    byId.set(id, [...(byId.get(id) ?? []), path]);
  }
  return [...byId].map(([assetId, files]) => ({ assetId, files }));
}

/** The asset id an assets/_incoming candidate belongs to: its folder, or its stem under music/. */
function incomingId(file: string): string {
  const folder = basename(dirname(file));
  return folder === 'music' ? basename(file, extname(file)) : folder;
}

/**
 * The committed file a record covers. A committed path is itself; an assets/_incoming candidate
 * (gitignored) resolves to its promoted copy, assets/source/<category>/<id>/<id>.<ext>.
 */
export function committedFile(root: string, record: ApprovalRecord): string | undefined {
  if (!record.file.startsWith(`${INCOMING_ROOT}/`)) {
    return existsSync(join(root, record.file)) ? record.file : undefined;
  }
  const id = incomingId(record.file);
  const name = `${id}${extname(record.file)}`;
  const sourceRoot = join(root, SOURCE_ROOT);
  if (!existsSync(sourceRoot)) return undefined;
  return readdirSync(sourceRoot)
    .sort()
    .map((category) => `${SOURCE_ROOT}/${category}/${id}/${name}`)
    .find((path) => existsSync(join(root, path)));
}
