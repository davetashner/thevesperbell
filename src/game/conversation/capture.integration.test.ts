// @vitest-environment happy-dom
// Talking is modal for input (mw-e22.19), wired as src/main.ts wires it: a real world, the
// Conversations controller, the UI root and its bridge, the player input adapter (pointer lock, mouse,
// pad) and the sampler. AC-1: opening a conversation releases the pointer lock and a click on the
// canvas does not take it back while it is open; after it ends a click locks again. AC-2: pad A and a
// mouse button during a choice reach the sim as no action at all. AC-3: after it ends, gameplay input
// flows again.
import type { DialogueDef } from '@content/types/dialogue';
import {
  CreatureComponent,
  DialogueRuntime,
  interacted,
  InteractableComponent,
  MemoryLogicHost,
  placeEntity,
  registerCreatureComponents,
  World,
  type ActionFrame,
} from '@sim/index';
import { describe, expect, it } from 'vitest';
import { UiRoot } from '@ui/index';
import { ActionSampler } from '../input';
import { fakePad } from '../input/fake-gamepad';
import { attachPlayerInput } from '../player/pointer-lock';
import { createUiGameBridge } from '../ui/index';
import { conversationCapture } from './capture';
import { Conversations } from './conversation';

const chat = {
  id: 'chat',
  speakers: [{ id: 'npc', name: 'Villager' }],
  entries: [{ id: 'default', node: 'menu' }],
  nodes: [
    {
      id: 'menu',
      kind: 'choice',
      options: [
        { id: 'leave', text: 'leave', showWhenLocked: false, once: false, end: true },
        { id: 'stay', text: 'stay', showWhenLocked: false, once: false, end: true },
      ],
    },
  ],
} as unknown as DialogueDef;

function game() {
  document.body.innerHTML = '';
  const world = new World<never>({ seed: 1 });
  registerCreatureComponents(world);
  world.register(InteractableComponent);
  const player = world.spawn();
  placeEntity(world, player, { x: 0, y: 0, z: 0 }, 0.4);
  const npc = world.spawn();
  placeEntity(world, npc, { x: 0, y: 0, z: 2 }, 0.4);
  const at = { x: 0, y: 0, z: 2 };
  world.add(npc, CreatureComponent, {
    origin: { creature: 'villager', at, facing: { x: 0, y: 0, z: 1 } },
    behaviour: 'idle',
    tuning: {},
    needs: {},
  });
  const runtime = new DialogueRuntime({
    world,
    host: new MemoryLogicHost({}),
    dialogues: (id) => (id === 'chat' ? chat : undefined),
  });
  const ui = new UiRoot(document.body, { unstyled: true });
  const conversations = new Conversations({
    world,
    player,
    runtime,
    dialogueOf: () => 'chat',
    capture: conversationCapture(ui),
  });

  // The page: a canvas that takes the pointer lock when asked, and a pad.
  const window = new EventTarget();
  let pad = fakePad();
  const unlocked: unknown = null;
  const doc = Object.assign(new EventTarget(), {
    pointerLockElement: unlocked,
    exitPointerLock: () => {
      doc.pointerLockElement = unlocked;
      doc.dispatchEvent(new Event('pointerlockchange'));
    },
  });
  const canvas = Object.assign(new EventTarget(), {
    requestPointerLock: () => {
      doc.pointerLockElement = canvas;
      doc.dispatchEvent(new Event('pointerlockchange'));
    },
  });
  const sampler = new ActionSampler();
  const input = attachPlayerInput(sampler, {
    window,
    document: doc,
    element: canvas,
    held: () => ui.capturesInput,
    gamepad: { navigator: { getGamepads: () => [pad] }, hasFocus: () => true },
  });
  // As in main.ts: a screen that captures input lets go of the pointer.
  ui.subscribe(({ capturesInput }) => {
    if (capturesInput && doc.pointerLockElement !== null) doc.exitPointerLock();
  });
  const bridge = createUiGameBridge<ActionFrame>({ ui, sampleCommands: sampler.sampleCommands });

  let tick = 0;
  /** One sim tick: the frames the loop would hand the sim, then the controller's afterStep. */
  const step = (): ActionFrame[] => {
    const frames = [...bridge.sampleCommands(tick++)];
    world.step();
    conversations.afterStep();
    return frames;
  };
  const lock = async (): Promise<void> => {
    canvas.dispatchEvent(new Event('click'));
    await Promise.resolve();
  };
  const talk = (): void => {
    world.events.emit(interacted, { actor: player, target: npc, verb: 'talk', affordance: 0 });
    step();
  };
  return {
    ui,
    conversations,
    doc,
    input,
    step,
    lock,
    talk,
    setPad: (...pressed: Parameters<typeof fakePad>[0] extends infer O ? [O] : never) => {
      pad = fakePad(...pressed);
    },
    mouse: (type: 'mousedown' | 'mouseup') => {
      window.dispatchEvent(Object.assign(new Event(type), { button: 0 }));
    },
    key: (type: 'keydown' | 'keyup', code: string) => {
      window.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { code }));
    },
  };
}

const acts = (frames: readonly ActionFrame[]): boolean =>
  frames.some(
    (f) => f.primaryAttack.pressed || f.primaryAttack.held || f.interact.pressed || f.jump.pressed,
  );

describe('a conversation holds gameplay input (mw-e22.19)', () => {
  it('the capture screen takes every UI intent: none closes it or moves focus', () => {
    const { ui, talk } = game();
    talk();
    expect(ui.capturesInput).toBe(true);
    expect(ui.intent('back', 'gamepad')).toBe(true);
    expect(ui.intent('confirm', 'gamepad')).toBe(true);
    expect(ui.capturesInput).toBe(true);
  });

  it('AC-1: opening releases the pointer lock and a click does not take it back; ending lets a click lock again', async () => {
    const { conversations, doc, input, lock, talk, step } = game();
    await lock();
    expect(input.locked).toBe(true);
    talk();
    expect(conversations.active).toBe(true);
    expect(doc.pointerLockElement).toBeNull();
    expect(input.locked).toBe(false);
    await lock();
    expect(doc.pointerLockElement).toBeNull();
    conversations.choose(0);
    step();
    expect(conversations.active).toBe(false);
    await lock();
    expect(input.locked).toBe(true);
  });

  it('AC-2: pad A during a choice swings, interacts and jumps with nothing', () => {
    const { conversations, setPad, talk, step } = game();
    talk();
    expect(conversations.readout().kind).toBe('choice');
    setPad({ pressed: ['PadA', 'PadX', 'PadRT'] });
    const frames: ActionFrame[] = [];
    for (let i = 0; i < 3; i++) frames.push(...step());
    expect(frames).toEqual([]);
  });

  it('AC-2: a mouse button and the keys withhold their actions too, even if the lock were still held', async () => {
    const { lock, mouse, key, talk, step } = game();
    await lock();
    mouse('mousedown');
    key('keydown', 'Space');
    expect(acts(step())).toBe(true); // unlocked-by-dialogue is not yet in force: gameplay works
    talk();
    mouse('mouseup');
    mouse('mousedown');
    key('keydown', 'KeyE');
    expect(step()).toEqual([]);
  });

  it('AC-3: after it ends, gameplay input works again', async () => {
    const { conversations, lock, mouse, talk, step } = game();
    talk();
    conversations.choose(1);
    step();
    expect(conversations.active).toBe(false);
    await lock();
    mouse('mousedown');
    const frames = step();
    expect(frames).toHaveLength(1);
    expect(acts(frames)).toBe(true);
  });
});
