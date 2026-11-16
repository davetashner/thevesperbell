// Where runtime portrait art is served (style bible §15.2: public/assets/<category>/); the dialogue
// box and the shop window paint a character's face from it (mw-e37.433).

/** Base URL of the runtime portraits. */
export const PORTRAIT_BASE_URL = '/assets/portrait';

/** The CSS `url()` of portrait asset `id`. */
export function portraitCssUrl(id: string): string {
  return `url("${PORTRAIT_BASE_URL}/${id}.webp")`;
}
