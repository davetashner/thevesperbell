// @vitest-environment node
import { BufferGeometry, Texture } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { trackUploads } from './index';

describe('trackUploads (mw-ju8.44)', () => {
  it('AC-2: release frees what the renderer listened to dispose on, once, and stop restores three', () => {
    const uploads = trackUploads();
    const texture = new Texture();
    const geometry = new BufferGeometry();
    const freed = vi.fn();
    // What WebGLTextures / WebGLGeometries do on upload.
    texture.addEventListener('dispose', freed);
    geometry.addEventListener('dispose', freed);
    uploads.release();
    expect(freed).toHaveBeenCalledTimes(2);
    // Released objects are no longer tracked; a re-upload is tracked again.
    uploads.release();
    expect(freed).toHaveBeenCalledTimes(2);
    texture.addEventListener('dispose', freed);
    uploads.release();
    expect(freed).toHaveBeenCalledTimes(3);
    uploads.stop();
    const later = new Texture();
    later.addEventListener('dispose', freed);
    uploads.release();
    expect(freed).toHaveBeenCalledTimes(3);
  });

  it('AC-2: an object that disposes itself is not freed twice', () => {
    const uploads = trackUploads();
    const texture = new Texture();
    const dispose = vi.spyOn(texture, 'dispose');
    texture.addEventListener('dispose', () => undefined);
    texture.dispose();
    uploads.release();
    expect(dispose).toHaveBeenCalledOnce();
    uploads.stop();
  });
});
