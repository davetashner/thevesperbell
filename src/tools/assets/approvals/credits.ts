// Reads the asset tables of assets/CREDITS.md: each row's asset id (or glob), type and placeholder flag.
// Licence and field checks belong to the asset validator (mw-e37.2); approvals only need to know
// whether a runtime asset is a placeholder and which gates its type requires.

export interface CreditRow {
  /** Asset id or glob as written (`vfx-*`). */
  id: string;
  type: string;
  placeholder: boolean;
  /** 1-based line in CREDITS.md. */
  line: number;
}

const cells = (line: string): string[] =>
  line
    .split('|')
    .slice(1, -1)
    .map((c) => c.trim());

/** The asset id of a row's first cell: a leading `code span`, or else its first word. */
export function rowId(cell: string): string {
  const quoted = /^`([^`]+)`/.exec(cell);
  return quoted === null ? String(cell.split(/\s+/)[0]) : String(quoted[1]);
}

/** Rows of every table whose header starts with "Asset id"; empty `_(none yet)_` rows are skipped. */
export function parseCredits(markdown: string): CreditRow[] {
  const rows: CreditRow[] = [];
  let inAssetTable = false;
  markdown.split('\n').forEach((line, index) => {
    if (!line.startsWith('|')) {
      inAssetTable = false;
      return;
    }
    const row = cells(line);
    const first = String(row[0]);
    if (first === 'Asset id') {
      inAssetTable = true;
      return;
    }
    if (!inAssetTable || row.length < 2 || /^-+$/.test(first) || first.startsWith('_(')) return;
    rows.push({
      id: rowId(first),
      type: String(row[1]),
      placeholder: String(row.at(-1)).toLowerCase() === 'yes',
      line: index + 1,
    });
  });
  return rows;
}

const globRegExp = (glob: string): RegExp =>
  new RegExp(`^${glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);

/** The row for an asset id: an exact id beats a glob. */
export function findCredit(rows: readonly CreditRow[], assetId: string): CreditRow | undefined {
  return (
    rows.find((r) => r.id === assetId) ??
    rows.find((r) => r.id.includes('*') && globRegExp(r.id).test(assetId))
  );
}
