// pnpm assets:approve and pnpm assets:validate (mw-e37.3). Run directly by Node (type stripping), so
// imports carry their .ts extension and nothing here needs Vite.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { parseCredits } from './credits.ts';
import {
  approvalRecord,
  REQUIRED_GATES,
  ASSET_ID,
  GATES,
  parseApprovals,
  serializeApprovals,
  type ApprovalsFile,
  type Gate,
} from './schema.ts';
import {
  committedFile,
  INCOMING_ROOT,
  listRuntimeAssets,
  sha256File,
  SOURCE_ROOT,
  validateApprovals,
} from './validate.ts';

export const APPROVALS_PATH = 'assets/approvals.json';
export const CREDITS_PATH = 'assets/CREDITS.md';
/** The owner's standing pre-approval (assets/prompts/README.md); music takes are the owner's own pick. */
export const STANDING_APPROVER = 'owner (standing pre-approval 2026-11-16)';
export const MUSIC_APPROVER = 'owner';
const COMMENT =
  'Owner approval gates (mw-e37.3, style bible §16–17). Append with pnpm assets:approve; never hand-edit a record. pnpm assets:validate fails a non-placeholder runtime asset without a matching approved record.';

/** Candidate file extensions each gate approves, in assets/_incoming/<asset-id>/<version>.<ext>. */
export const CANDIDATE_EXTENSIONS: Record<Gate, readonly string[]> = {
  image: ['.png', '.jpg', '.jpeg', '.webp'],
  turntable: ['.glb', '.gltf'],
  'music-take': ['.wav', '.flac', '.aiff', '.mp3', '.m4a', '.ogg'],
  'sfx-batch': ['.wav', '.flac', '.mp3', '.ogg'],
};

export const APPROVE_USAGE = `Usage: pnpm assets:approve <asset-id> <gate> <version> [options]

Hashes the candidate assets/_incoming/<asset-id>/<version>.<ext> (music takes may also sit at
assets/_incoming/music/<asset-id>.<ext>) and appends a record to ${APPROVALS_PATH}.
Gates: ${GATES.join(', ')}.

Options:
  --reject              record a rejection instead of an approval
  --note <text>         Claude's check notes or the owner's reason
  --approver <name>     name or handle (default "${STANDING_APPROVER}", "${MUSIC_APPROVER}" for music takes)
  --file <path>         hash this repo-relative file instead of the _incoming candidate
  --promote <category>  copy the approved candidate to ${SOURCE_ROOT}/<category>/<asset-id>/<asset-id>.<ext>
                        and record that path`;

export const VALIDATE_USAGE = `Usage: pnpm assets:validate

Fails when a non-placeholder runtime asset (public/assets/**) lacks an approved ${APPROVALS_PATH}
record for a gate its assets/CREDITS.md type requires (src/tools/assets/approvals/required-gates.json),
or when the committed file no longer matches the approved hash.`;

export interface CliIo {
  root: string;
  log(line: string): void;
  error(line: string): void;
  now(): Date;
}

export const defaultIo: CliIo = {
  root: process.cwd(),
  log: (line) => {
    console.log(line);
  },
  error: (line) => {
    console.error(line);
  },
  now: () => new Date(),
};

function readApprovals(root: string): ApprovalsFile {
  const path = join(root, APPROVALS_PATH);
  if (!existsSync(path)) return { $comment: COMMENT, records: [] };
  return parseApprovals(readFileSync(path, 'utf8'), APPROVALS_PATH);
}

function findCandidate(root: string, assetId: string, gate: Gate, version: string): string {
  const exts = CANDIDATE_EXTENSIONS[gate];
  const looked = exts.map((ext) => `${INCOMING_ROOT}/${assetId}/${version}${ext}`);
  if (gate === 'music-take') looked.push(...exts.map((ext) => `${INCOMING_ROOT}/music/${assetId}${ext}`));
  const found = looked.filter((path) => existsSync(join(root, path)));
  if (found.length === 1) return String(found[0]);
  if (found.length === 0) {
    throw new Error(`no ${gate} candidate for ${assetId} ${version}; looked for ${looked.join(', ')}`);
  }
  throw new Error(`more than one ${gate} candidate for ${assetId} ${version}: ${found.join(', ')}`);
}

function approve(argv: string[], io: CliIo): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      reject: { type: 'boolean', default: false },
      note: { type: 'string', default: '' },
      approver: { type: 'string' },
      file: { type: 'string' },
      promote: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help) {
    io.log(APPROVE_USAGE);
    return 0;
  }
  const [assetId = '', gateArg = '', version = ''] = positionals;
  if (positionals.length !== 3) throw new Error(`expected 3 arguments\n\n${APPROVE_USAGE}`);
  if (!ASSET_ID.test(assetId)) throw new Error(`"${assetId}" is not a lower-kebab-case asset id`);
  if (!(GATES as readonly string[]).includes(gateArg)) {
    throw new Error(`unknown gate "${gateArg}"; expected one of ${GATES.join(', ')}`);
  }
  const gate = gateArg as Gate;
  if (values.promote !== undefined && values.reject) {
    throw new Error('--promote applies to approvals only');
  }
  if (values.promote !== undefined && !/^[a-z][a-z0-9-]*$/.test(values.promote)) {
    throw new Error(`--promote needs a lower-kebab-case category, got "${values.promote}"`);
  }

  const approvals = readApprovals(io.root);
  let file = values.file ?? findCandidate(io.root, assetId, gate, version);
  if (!existsSync(join(io.root, file))) throw new Error(`${file} does not exist`);
  const sha256 = sha256File(join(io.root, file));
  if (values.promote !== undefined) {
    const target = `${SOURCE_ROOT}/${values.promote}/${assetId}/${assetId}${extname(file)}`;
    mkdirSync(dirname(join(io.root, target)), { recursive: true });
    copyFileSync(join(io.root, file), join(io.root, target));
    io.log(`promoted ${file} → ${target}`);
    file = target;
  }
  const record = approvalRecord.parse({
    assetId,
    gate,
    version,
    sha256,
    decision: values.reject ? 'rejected' : 'approved',
    approver: values.approver ?? (gate === 'music-take' ? MUSIC_APPROVER : STANDING_APPROVER),
    date: io.now().toISOString(),
    file,
    note: values.note,
  });
  approvals.records.push(record);
  writeFileSync(join(io.root, APPROVALS_PATH), serializeApprovals(approvals));
  io.log(`${record.decision} ${assetId} ${gate} ${version} (sha256 ${sha256}) → ${APPROVALS_PATH}`);
  return 0;
}

function validate(argv: string[], io: CliIo): number {
  if (argv.includes('--help') || argv.includes('-h')) {
    io.log(VALIDATE_USAGE);
    return 0;
  }
  const report = validateApprovals({
    assets: listRuntimeAssets(io.root),
    credits: parseCredits(readFileSync(join(io.root, CREDITS_PATH), 'utf8')),
    records: readApprovals(io.root).records,
    requiredGates: REQUIRED_GATES,
    committedFile: (record) => committedFile(io.root, record),
    hashOf: (path) => sha256File(join(io.root, path)),
  });
  for (const problem of report.problems) io.error(problem);
  io.log(
    `assets:validate approvals: ${String(report.finals)} final and ${String(report.placeholders)} placeholder runtime assets, ${String(report.problems.length)} problem(s)`,
  );
  return report.problems.length === 0 ? 0 : 1;
}

/** Runs a command; any thrown error is printed and exits 1. */
export function run(command: 'approve' | 'validate', argv: string[], io: CliIo = defaultIo): number {
  try {
    return command === 'approve' ? approve(argv, io) : validate(argv, io);
  } catch (error) {
    io.error(`assets:${command}: ${(error as Error).message}`);
    return 1;
  }
}
