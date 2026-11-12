// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { DialogueBox, type DialogueBoxModel } from '@ui/dialogue-box';

const LINE: DialogueBoxModel = {
  speaker: 'Villager',
  text: 'Oh, hello there.',
  choices: [],
  hint: 'Enter to continue',
};

const part = (box: DialogueBox, name: string): HTMLElement => {
  const el = box.element.querySelector<HTMLElement>(`[data-part="${name}"]`);
  if (el === null) throw new Error(`no ${name}`);
  return el;
};

describe('dialogue box (mw-e22.9)', () => {
  it('is hidden until a conversation runs, then shows the speaker, the line and the hint', () => {
    const box = new DialogueBox();
    expect(box.element.dataset['testid']).toBe('dialogue-box');
    expect(box.element.hidden).toBe(true);
    box.update(LINE);
    expect(box.element.hidden).toBe(false);
    expect(part(box, 'speaker').textContent).toBe('Villager');
    expect(part(box, 'text').textContent).toBe('Oh, hello there.');
    expect(part(box, 'hint').textContent).toBe('Enter to continue');
    expect(part(box, 'choices').hidden).toBe(true);
    box.update(null);
    expect(box.element.hidden).toBe(true);
  });

  it('lists the options in order and marks a locked one with its reason', () => {
    const box = new DialogueBox();
    box.update({
      speaker: '',
      text: '',
      hint: 'Press 1 to 3',
      choices: [
        { text: 'Who are you?', locked: false, reason: '' },
        { text: 'Open the gate', locked: true, reason: 'needs Iron Key' },
      ],
    });
    expect(part(box, 'speaker').hidden).toBe(true);
    expect(part(box, 'text').hidden).toBe(true);
    const items = [...part(box, 'choices').querySelectorAll('li')];
    expect(items.map((li) => li.textContent)).toEqual([
      'Who are you?',
      'Open the gate (needs Iron Key)',
    ]);
    expect(items.map((li) => li.dataset['locked'])).toEqual(['false', 'true']);
    expect(part(box, 'choices').hidden).toBe(false);
    box.update(LINE);
    expect(part(box, 'choices').children).toHaveLength(0);
  });
});
