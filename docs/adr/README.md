# Architecture Decision Records

An ADR records one significant decision: what we chose, why, what we rejected and when to reopen it. ADRs
are subordinate to `CONSTITUTION.md` and sit alongside `docs/backlog-contract.md`: when an ADR changes a
project-wide decision, the same PR updates the contract row that states it.

## Index

| ADR | Title | Status | Bead |
|---|---|---|---|
| [0001](0001-engine-and-physics.md) | Renderer and physics engine | Accepted | `mw-e00.13` |
| [0002](0002-game-title.md) | Game title — The Vesper Bell | Accepted | `mw-e39.2` |
| [0003](0003-encumbrance-model.md) | Encumbrance model — weightless inventory, weighted armor, physical carrying | Accepted | `mw-e17.1` |
| [0004](0004-progression-model.md) | Progression model — in-world capability unlocks, no XP, no respec | Accepted | `mw-e19.1` |
| [0005](0005-ai-architecture.md) | AI decision architecture — HFSM alert states with utility inside | Accepted | `mw-e11.1` |
| [0006](0006-navmesh-and-pathfinding.md) | Navmesh and pathfinding — a pure-TypeScript bake and query in the sim | Proposed | `mw-e11.4` |
| [0007](0007-spell-pipeline-extension-points.md) | Spell pipeline extension points — gates, registries, pending deliveries, free casts | Accepted | `mw-e06.21` |

## Writing one

1. Copy [`template.md`](template.md) to `NNNN-kebab-title.md` with the next free number. Numbers are never
   reused; ADR-0001 was reserved for the engine spike before ADR-0002 was written.
2. Keep the header bullets (Status, Date, Decider, Bead). Status is `Proposed` while the PR is open and
   `Accepted` when the owner merges it.
3. Lead with the decision, then context, options, evidence, consequences and revisit triggers. Evidence
   names the commands, versions and machine so someone else can reproduce it; say what was not tested.
4. Link the ADR from the bead and add it to the index above in the same PR.

## Changing a decision

Do not rewrite an accepted ADR's decision. Write a new ADR that supersedes it, set the old one's status to
`Superseded by ADR-NNNN`, and update the contract. Typos, broken links and added evidence that does not
change the decision can be edited in place.
