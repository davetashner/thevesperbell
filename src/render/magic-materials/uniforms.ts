// Typed access to a ShaderMaterial's uniforms (mw-e29.7): the library creates every uniform it reads,
// so a missing one is a bug and throws instead of being silently skipped.
//
// Render-only; exercised by tests/integration/magic-materials.test.ts and the e2e specs.

import type { ShaderMaterial } from 'three';

/** The uniform `name` of `material`; throws if the material has none of that name. */
// The caller states the type of a uniform it created itself, so the parameter appears only once.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- see above
export function uniform<T>(material: ShaderMaterial, name: string): { value: T } {
  const found = material.uniforms[name] as { value: T } | undefined;
  if (found === undefined) throw new Error(`no uniform ${name}`);
  return found;
}
