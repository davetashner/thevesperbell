// The debug console's command registry (mw-e33.1). A command is registered once with its name, a
// one-line summary, its argument syntax, a zod schema over the typed argument tokens, an optional
// completer and `run`. `execute` parses a typed line, validates the arguments (printing the problem
// and the usage on failure) and runs the command; `complete` does Tab completion of command names
// and, through each command's completer, of its arguments (content ids, settings, scenes…).
//
// Systems add their own commands with `registerCommand` (items, quests, AI… each owns its domain);
// the built-ins live in ./builtins.ts. `run` never touches sim state: commands that change the sim
// submit sim commands through the host, which queues them for the next tick.

import type { z } from 'zod';
import { closest, commonPrefix, tokenize } from './text';

/** What a command prints: one line, several, or nothing. */
export type ConsoleReply = string | readonly string[] | undefined;

/** Thrown by `run` for a failure the developer should read (printed without a stack). */
export class ConsoleError extends Error {
  override readonly name = 'ConsoleError';

  constructor(readonly lines: readonly string[]) {
    super(lines.join('\n'));
  }
}

export interface CommandSpec<TArgs, THost> {
  /** Lower-case, no spaces; a dot groups related commands (`ctl.get`, `ctl.set`). */
  readonly name: string;
  /** One line for `help`. */
  readonly summary: string;
  /** Argument syntax after the name, e.g. `<contentId> [count]` ('' for none). */
  readonly usage: string;
  /** Validates and converts the argument tokens (the words after the name). */
  readonly args: z.ZodType<TArgs>;
  /** Candidates for argument `index` (0-based), filtered by the typed prefix. */
  readonly complete?: (index: number, host: THost) => readonly string[];
  run(args: TArgs, host: THost): ConsoleRun;
}

/** The outcome of one typed line. */
export interface ConsoleResult {
  readonly ok: boolean;
  readonly lines: readonly string[];
  /** Set when the command is still working (mw-e27.6): what it prints once it finishes. */
  readonly later?: Promise<ConsoleResult>;
}

/** The outcome of Tab: the new input line and, when ambiguous, the candidates. */
export interface Completion {
  readonly line: string;
  readonly options: readonly string[];
}

type AnyCommand<THost> = CommandSpec<unknown, THost>;

/** What `run` may return: a reply now, or a promise of one (a command that reads storage). */
export type ConsoleRun = ConsoleReply | Promise<ConsoleReply>;

const lines = (reply: ConsoleReply): readonly string[] =>
  reply === undefined ? [] : typeof reply === 'string' ? [reply] : reply;

/** `issue` as "arg 2: expected number" (or the bare message for the whole argument list). */
function describeIssue(issue: z.core.$ZodIssue): string {
  const [first] = issue.path;
  return typeof first === 'number' ? `arg ${String(first + 1)}: ${issue.message}` : issue.message;
}

export class CommandRegistry<THost> {
  private readonly commands = new Map<string, AnyCommand<THost>>();

  constructor(private readonly host: THost) {}

  /** Adds a command. @throws Error for a malformed or duplicate name. */
  registerCommand<TArgs>(spec: CommandSpec<TArgs, THost>): void {
    if (!/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/.test(spec.name)) {
      throw new Error(
        `command name "${spec.name}" must be lower-case letters, digits and dashes, with dots between words of a group (ctl.set)`,
      );
    }
    if (this.commands.has(spec.name)) throw new Error(`command "${spec.name}" already exists`);
    this.commands.set(spec.name, spec);
  }

  /** Every command, sorted by name. */
  list(): readonly AnyCommand<THost>[] {
    return [...this.commands.values()].sort((a, b) => (a.name < b.name ? -1 : 1));
  }

  get(name: string): AnyCommand<THost> | undefined {
    return this.commands.get(name);
  }

  /** `name usage`, the syntax line of a command. */
  usageOf(spec: AnyCommand<THost>): string {
    return spec.usage === '' ? spec.name : `${spec.name} ${spec.usage}`;
  }

  /** Parses, validates and runs one typed line. */
  execute(line: string): ConsoleResult {
    const [name, ...args] = tokenize(line);
    if (name === undefined) return { ok: true, lines: [] };
    const spec = this.commands.get(name.toLowerCase());
    if (spec === undefined) {
      const names = [...this.commands.keys()];
      return {
        ok: false,
        lines: [
          `unknown command "${name}"; did you mean: ${closest(name, names).join(', ')}?`,
          'type help for the list of commands',
        ],
      };
    }
    const parsed = spec.args.safeParse(args);
    if (!parsed.success) {
      return {
        ok: false,
        lines: [
          `${spec.name}: invalid arguments: ${parsed.error.issues.map(describeIssue).join('; ')}`,
          `usage: ${this.usageOf(spec)}`,
        ],
      };
    }
    const failed = (error: unknown): ConsoleResult =>
      error instanceof ConsoleError
        ? { ok: false, lines: error.lines }
        : { ok: false, lines: [`${spec.name} failed: ${String(error)}`] };
    try {
      const reply = spec.run(parsed.data, this.host);
      if (reply instanceof Promise) {
        const later = reply.then(
          (done): ConsoleResult => ({ ok: true, lines: lines(done) }),
          failed,
        );
        return { ok: true, lines: [], later };
      }
      return { ok: true, lines: lines(reply) };
    } catch (error) {
      return failed(error);
    }
  }

  /** Tab completion of the last word of `line` (see the file header). */
  complete(line: string): Completion {
    const cut = line.lastIndexOf(' ');
    const head = line.slice(0, cut + 1); // everything before the word being completed
    const prefix = line.slice(cut + 1);
    let candidates: readonly string[];
    if (cut === -1) {
      candidates = [...this.commands.keys()].sort();
    } else {
      const spec = this.commands.get(line.slice(0, line.indexOf(' ')).toLowerCase());
      const index = line.split(' ').length - 2;
      candidates = spec?.complete?.(index, this.host) ?? [];
    }
    const matches = candidates.filter((candidate) => candidate.startsWith(prefix));
    if (matches.length === 0) return { line, options: [] };
    const shared = commonPrefix(matches);
    if (matches.length === 1) return { line: `${head}${shared} `, options: [] };
    return { line: `${head}${shared}`, options: matches };
  }
}
