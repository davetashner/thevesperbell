// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { setHighContrast, setTextBackdrop, setTextScale } from '@ui/comfort';
import {
  DialogueBox,
  REVEAL_CHARS_PER_SECOND,
  type DialogueBoxChoice,
  type DialogueBoxHandlers,
  type DialogueBoxLabels,
  type DialogueBoxModel,
} from '@ui/dialogue-box';
import { UiRoot } from '@ui/screens';
import { findClippedText, type OverflowGeometry } from '@ui/testing/overflow';
import {
  contrastRatio,
  DIALOGUE_HIGH_CONTRAST_PLATE,
  DIALOGUE_HIGH_CONTRAST_TEXT,
  DIALOGUE_MUTED,
  DIALOGUE_PLATE,
  DIALOGUE_TEXT,
  uiStyleSheet,
} from '@ui/tokens';

const LABELS: DialogueBoxLabels = {
  replies: 'Replies',
  locked: 'Locked',
  history: 'History',
  historyTitle: 'History',
  historyEmpty: 'Nothing said yet.',
};

const model = (over: Partial<DialogueBoxModel> = {}): DialogueBoxModel => ({
  speaker: 'Villager',
  portrait: 'villager',
  text: 'Oh, hello there.',
  lineKey: 1,
  choices: [],
  focus: 0,
  hint: 'Enter to continue',
  history: [],
  historyOpen: false,
  labels: LABELS,
  ...over,
});

const choice = (text: string, over: Partial<DialogueBoxChoice> = {}): DialogueBoxChoice => ({
  text,
  locked: false,
  reason: '',
  tags: [],
  ...over,
});

const part = (box: DialogueBox, name: string): HTMLElement => {
  const el = box.element.querySelector<HTMLElement>(`[data-part="${name}"]`);
  if (el === null) throw new Error(`no ${name}`);
  return el;
};
const items = (box: DialogueBox): HTMLElement[] => [
  ...part(box, 'choices').querySelectorAll<HTMLElement>('li'),
];
const said = (box: DialogueBox): string => part(box, 'text').textContent;

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('dialogue box (mw-e22.10)', () => {
  it('is hidden until a conversation runs, then shows the speaker, portrait slot, line and hint', () => {
    const box = new DialogueBox();
    expect(box.element.dataset['testid']).toBe('dialogue-box');
    expect(box.element.hidden).toBe(true);
    box.update(model());
    expect(box.element.hidden).toBe(false);
    expect(part(box, 'speaker').textContent).toBe('Villager');
    expect(part(box, 'portrait').dataset['portrait']).toBe('villager');
    expect(part(box, 'portrait').getAttribute('aria-hidden')).toBe('true');
    expect(said(box)).toBe('Oh, hello there.');
    expect(part(box, 'hint').textContent).toBe('Enter to continue');
    expect(part(box, 'choices').hidden).toBe(true);
    expect(part(box, 'outcome').hidden).toBe(true);
    expect(part(box, 'history').hidden).toBe(true);
    expect(part(box, 'announce').textContent).toBe('Villager: Oh, hello there.');
    box.update(null);
    expect(box.element.hidden).toBe(true);
  });

  it('AC-2: at the instant speed the whole line is there on the first frame', () => {
    const box = new DialogueBox();
    box.setRevealSpeed('instant');
    box.update(model({ text: 'A long line that would take a while to type out.' }));
    const shown = box.element.querySelector('.vb-dialogue-shown');
    expect(shown?.textContent).toBe('A long line that would take a while to type out.');
    expect(box.revealing).toBe(false);
    box.frame(0);
    expect(shown?.textContent).toBe('A long line that would take a while to type out.');
  });

  it('types a line out at the reveal speed; the rest stays in the text, transparent', () => {
    const box = new DialogueBox();
    box.setRevealSpeed('normal');
    box.update(model({ text: 'x'.repeat(90) }));
    const shown = box.element.querySelector('.vb-dialogue-shown');
    const pending = box.element.querySelector('.vb-dialogue-pending');
    expect(box.revealing).toBe(true);
    expect(said(box)).toBe('x'.repeat(90));
    box.frame(1000);
    expect(shown?.textContent).toBe('');
    box.frame(2000);
    expect(shown?.textContent).toHaveLength(REVEAL_CHARS_PER_SECOND.normal);
    expect(pending?.textContent).toHaveLength(90 - REVEAL_CHARS_PER_SECOND.normal);
    box.frame(9000);
    expect(shown?.textContent).toHaveLength(90);
    expect(box.revealing).toBe(false);
    box.frame(9500); // nothing left to type
    expect(shown?.textContent).toHaveLength(90);
  });

  it('skipping shows the rest at once; a new line restarts the reveal; a repeat of the same line does not', () => {
    const box = new DialogueBox();
    box.update(model({ text: 'first line here' }));
    box.finishReveal();
    expect(box.revealing).toBe(false);
    box.update(model({ text: 'first line here' })); // same key
    expect(box.revealing).toBe(false);
    box.update(model({ text: 'second line', lineKey: 2 }));
    expect(box.revealing).toBe(true);
    box.setRevealSpeed('instant'); // switching to instant finishes the line in view
    expect(box.revealing).toBe(false);
    box.setRevealSpeed('fast');
    box.update(model({ text: 'third', lineKey: 3 }));
    expect(box.revealing).toBe(true);
    // Options beside the line: it is already read.
    box.update(model({ text: 'third', lineKey: 3, choices: [choice('a')] }));
    expect(box.revealing).toBe(false);
    box.update(model({ text: 'fourth', lineKey: 4, choices: [choice('a')] }));
    expect(box.revealing).toBe(false);
  });

  it('lists the options in order with numbers, marks the focused one, and announces them once', () => {
    const box = new DialogueBox();
    box.update(
      model({
        choices: [choice('Who are you?'), choice('Heard anything lately?'), choice('Goodbye.')],
        focus: 1,
        hint: 'Press 1 to 3',
      }),
    );
    const list = items(box);
    expect(list.map((li) => li.querySelector('.vb-dialogue-choice-text')?.textContent)).toEqual([
      'Who are you?',
      'Heard anything lately?',
      'Goodbye.',
    ]);
    expect(list.map((li) => li.querySelector('.vb-dialogue-number')?.textContent)).toEqual([
      '1.',
      '2.',
      '3.',
    ]);
    expect(list.map((li) => li.dataset['focused'])).toEqual(['false', 'true', 'false']);
    expect(list.map((li) => li.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
    expect(part(box, 'choices').getAttribute('role')).toBe('listbox');
    expect(part(box, 'announce').textContent).toBe(
      'Replies: Who are you?. Heard anything lately?. Goodbye.',
    );
    box.update(model({ choices: [], hint: 'x' }));
    expect(part(box, 'choices').hidden).toBe(true);
    expect(items(box)).toHaveLength(0);
  });

  it('AC-4: a locked option is greyed, and while focused shows why; others show only the lock', () => {
    const box = new DialogueBox();
    document.body.append(box.element);
    const choices = [
      choice('Open the gate', { locked: true, reason: 'Needs iron key' }),
      choice('Ask about the road'),
      choice('Show the ring', { locked: true, reason: 'Needs 2 x ring' }),
    ];
    box.update(model({ choices, focus: 0 }));
    const reasons = (): (string | null)[] =>
      [...box.element.querySelectorAll<HTMLElement>('[data-part="reason"]')].map((el) =>
        el.hidden ? null : el.textContent,
      );
    expect(items(box).map((li) => li.dataset['locked'])).toEqual(['true', 'false', 'true']);
    expect(reasons()).toEqual(['Needs iron key', null]);
    expect(items(box)[0]?.getAttribute('aria-disabled')).toBe('true');
    const described = items(box)[0]?.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(described)?.textContent).toBe('Needs iron key');
    expect(items(box)[0]?.querySelector('.vb-dialogue-lock')).not.toBeNull();
    box.update(model({ choices, focus: 2 }));
    expect(reasons()).toEqual([null, 'Needs 2 x ring']);
    expect(items(box)[1]?.hasAttribute('aria-disabled')).toBe(false);
  });

  it('renders tags as glyph + label, and the odds label on an option that leads to a check', () => {
    const box = new DialogueBox();
    box.update(
      model({
        choices: [
          choice('I know a trick', {
            tags: [
              { kind: 'class', glyph: '*', label: '[Thief]' },
              { kind: 'item', glyph: '#', label: '[Iron key]' },
            ],
          }),
          choice('Let me talk to him', { odds: { level: 'hard', label: 'Persuade: hard' } }),
        ],
      }),
    );
    const tags = [...box.element.querySelectorAll<HTMLElement>('.vb-dialogue-tag')];
    expect(tags.map((t) => t.dataset['kind'])).toEqual(['class', 'item']);
    expect(tags.map((t) => t.querySelector('.vb-dialogue-tag-label')?.textContent)).toEqual([
      '[Thief]',
      '[Iron key]',
    ]);
    expect(tags[0]?.querySelector('.vb-dialogue-tag-glyph')?.textContent).toBe('*');
    const odds = box.element.querySelector<HTMLElement>('.vb-dialogue-odds');
    expect(odds?.textContent).toBe('Persuade: hard');
    expect(odds?.dataset['level']).toBe('hard');
  });

  it('shows the breakdown of a resolved check until the player moves on', () => {
    const box = new DialogueBox();
    const outcome = {
      success: true,
      title: 'Persuade worked',
      lines: ['Base +2', 'Score 6 against 5'],
    };
    box.update(model({ outcome }));
    const el = part(box, 'outcome');
    expect(el.hidden).toBe(false);
    expect(el.dataset['success']).toBe('true');
    expect([...el.querySelectorAll('p')].map((p) => p.textContent)).toEqual([
      'Persuade worked',
      'Base +2',
      'Score 6 against 5',
    ]);
    box.update(model({ outcome: { ...outcome, success: false } }));
    expect(el.dataset['success']).toBe('false');
    box.update(model());
    expect(el.hidden).toBe(true);
    expect(el.children).toHaveLength(0);
  });

  it('AC-5 (view half): the history panel lists the entries in order, or says there are none', () => {
    const box = new DialogueBox();
    box.update(model({ historyOpen: true }));
    expect(part(box, 'history').hidden).toBe(false);
    expect(box.element.dataset['history']).toBe('true');
    expect(part(box, 'history').textContent).toContain('Nothing said yet.');
    box.update(
      model({
        historyOpen: true,
        history: [
          { kind: 'divider', speaker: '', text: 'Conversation with Villager' },
          { kind: 'line', speaker: 'Villager', text: 'Oh, hello there.' },
          { kind: 'choice', speaker: '', text: 'Who are you?' },
        ],
      }),
    );
    const entries = [...box.element.querySelectorAll<HTMLElement>('.vb-dialogue-history-entry')];
    expect(entries.map((e) => `${e.dataset['kind'] ?? ''}|${e.textContent}`)).toEqual([
      'divider|Conversation with Villager',
      'line|Villager: Oh, hello there.',
      'choice|Who are you?',
    ]);
    box.scrollHistory(48);
    box.update(model({ historyOpen: false }));
    expect(part(box, 'history').hidden).toBe(true);
    expect(part(box, 'history-button').getAttribute('aria-expanded')).toBe('false');
  });

  it('the pointer picks, hovers, continues and opens the history', () => {
    const calls: string[] = [];
    const handlers: DialogueBoxHandlers = {
      choose: (i) => calls.push(`choose ${String(i)}`),
      focus: (i) => calls.push(`focus ${String(i)}`),
      advance: () => calls.push('advance'),
      toggleHistory: () => calls.push('history'),
    };
    const box = new DialogueBox(handlers);
    box.update(model({ choices: [choice('a'), choice('b')] }));
    items(box)[1]?.click();
    items(box)[0]?.dispatchEvent(new Event('pointerenter'));
    part(box, 'text').click();
    part(box, 'history-button').click();
    expect(calls).toEqual(['choose 1', 'focus 0', 'advance', 'history']);
    // With no handlers the pointer does nothing and nothing throws.
    const quiet = new DialogueBox();
    quiet.update(model({ choices: [choice('a')] }));
    items(quiet)[0]?.click();
    items(quiet)[0]?.dispatchEvent(new Event('pointerenter'));
    part(quiet, 'text').click();
    part(quiet, 'history-button').click();
  });

  it('hides the speaker and the line when they are empty', () => {
    const box = new DialogueBox();
    box.update(model({ speaker: '', text: '' }));
    expect(part(box, 'speaker').hidden).toBe(true);
    expect(part(box, 'text').hidden).toBe(true);
  });
});

describe('dialogue box settings (mw-e22.10)', () => {
  it('AC-3: at 200% text, a 300-character line and 4 choices wrap or scroll; nothing is clipped', () => {
    const ui = new UiRoot(document.body);
    const box = new DialogueBox();
    ui.hud.append(box.element);
    setTextScale(ui.element, 2);
    expect(ui.element.style.getPropertyValue('--ui-text-scale')).toBe('2');
    box.setRevealSpeed('instant');
    box.update(
      model({
        text: 'word '.repeat(60).trim(),
        choices: [choice('One'), choice('Two'), choice('Three'), choice('Four')],
      }),
    );
    const worst: OverflowGeometry = {
      textRect: () => ({ left: 0, top: 0, right: 5000, bottom: 5000 }),
      clipRect: () => ({ left: 0, top: 0, right: 100, bottom: 100 }),
      overflow: (el) => {
        const style = getComputedStyle(el);
        return { x: style.overflowX, y: style.overflowY };
      },
    };
    expect(findClippedText(box.element, worst)).toEqual([]);
    const main = box.element.querySelector('.vb-dialogue-main');
    expect(main === null ? '' : getComputedStyle(main).overflowY).toBe('auto');
    expect(getComputedStyle(box.element).maxHeight).toBe('80%');
  });

  it('AC-6: at 100% background opacity the text on the plate is at least 7:1, in both contrast modes', () => {
    expect(contrastRatio(DIALOGUE_TEXT, DIALOGUE_PLATE)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(DIALOGUE_MUTED, DIALOGUE_PLATE)).toBeGreaterThanOrEqual(7);
    expect(
      contrastRatio(DIALOGUE_HIGH_CONTRAST_TEXT, DIALOGUE_HIGH_CONTRAST_PLATE),
    ).toBeGreaterThanOrEqual(7);
    const css = uiStyleSheet();
    // The plate follows the text background setting, never below 90% (so 100% reads as the plate).
    expect(css).toContain(
      '--vb-dialogue-plate: rgb(30 27 46 / max(90%, calc(var(--ui-text-backdrop-opacity) * 100%)))',
    );
    expect(css).toContain(`--vb-dialogue-text: ${DIALOGUE_TEXT}`);
    const ui = new UiRoot(document.body);
    expect(setTextBackdrop(ui.element, 1)).toBe(1);
    expect(ui.element.style.getPropertyValue('--ui-text-backdrop-opacity')).toBe('1');
  });

  it('high contrast switches the root and restores it', () => {
    const ui = new UiRoot(document.body);
    setHighContrast(ui.element, true);
    expect(ui.element.dataset['contrast']).toBe('high');
    expect(uiStyleSheet()).toContain(`[data-contrast='high'] .vb-dialogue`);
    setHighContrast(ui.element, false);
    expect(ui.element.dataset['contrast']).toBeUndefined();
  });

  it('reveal speeds are characters a second, instant being unbounded', () => {
    expect(REVEAL_CHARS_PER_SECOND.instant).toBe(Number.POSITIVE_INFINITY);
    expect(REVEAL_CHARS_PER_SECOND.slow).toBeLessThan(REVEAL_CHARS_PER_SECOND.normal);
    expect(REVEAL_CHARS_PER_SECOND.normal).toBeLessThan(REVEAL_CHARS_PER_SECOND.fast);
  });
});
