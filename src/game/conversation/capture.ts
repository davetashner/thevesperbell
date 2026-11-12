// Talking is modal for input (mw-e22.19): while a conversation is open the UI root holds a
// capture-only screen, the same mechanism the menus use. Gameplay action frames are withheld (pad A
// or a mouse button on an option never swings, interacts or jumps) and the pointer lock is released,
// so the mouse can pick options. The dialogue box stays in the HUD and keeps its own keys and pad.

import type { Screen, UiRoot } from '@ui/index';

/** The `capture` hook for `Conversations`: opens the screen with the conversation, closes it with it. */
export function conversationCapture(ui: UiRoot): (open: boolean) => void {
  let screen: Screen | undefined;
  return (open) => {
    screen?.close();
    screen = undefined;
    if (!open) return;
    screen = ui.push({
      id: 'dialogue',
      label: 'Conversation',
      content: ui.element.ownerDocument.createElement('div'),
      // The box's own pad and keys handle every intent; none moves focus or closes this screen.
      onIntent: () => true,
    });
    // The box sits in the HUD, under the menus layer: clicks pass through to it.
    screen.element.style.pointerEvents = 'none';
  };
}
