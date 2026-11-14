// The epilogue console command (mw-e39.40): `epilogue.preview <ending>` plays the ending card and every
// slide a headline ending can show, with no events and no facts, so a writer or tester can read the
// slideshow without finishing the game.

import { HEADLINE_ENDINGS, type HeadlineEnding } from '@content/types/narration';
import { z } from 'zod';
import type { ConsoleHost } from '../console/builtins';
import type { CommandRegistry } from '../console/registry';

export interface EpilogueCommandOptions {
  /** Queues the preview: it plays once the console (a screen) is closed. */
  readonly preview: (ending: HeadlineEnding) => void;
}

export function registerEpilogueCommands(
  registry: CommandRegistry<ConsoleHost>,
  options: EpilogueCommandOptions,
): void {
  registry.registerCommand({
    name: 'epilogue.preview',
    summary:
      'play the epilogue slideshow for a headline ending (plays when the console closes; changes nothing)',
    usage: `<${HEADLINE_ENDINGS.join('|')}>`,
    args: z.tuple([z.enum(HEADLINE_ENDINGS)]),
    complete: (index) => (index === 0 ? HEADLINE_ENDINGS : []),
    run: ([ending]) => {
      options.preview(ending);
      return `the ${ending} epilogue plays when the console closes`;
    },
  });
}
