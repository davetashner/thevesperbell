// Composes the checkpoints of several sub-hosts (disposition, inventory, facts...) into the one a
// game `LogicHost` returns (mw-e22.15). Commit settles them in the order given; rollback undoes in
// reverse, so nested state unwinds innermost first. Each part must be a fresh checkpoint opened
// together, in the same order every time.

import type { LogicCheckpoint } from './types';

export function composeCheckpoints(...parts: readonly LogicCheckpoint[]): LogicCheckpoint {
  return {
    commit() {
      for (const part of parts) part.commit();
    },
    rollback() {
      for (const part of [...parts].reverse()) part.rollback();
    },
  };
}
