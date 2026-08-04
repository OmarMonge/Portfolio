// Snapshot: a complete, replayable description of what's on screen.
//
// Seed alone can't reproduce a shader — mutations depend on RNG history and
// weights change what a seed grows into. So the snapshot carries the AST
// itself (a small JSON tree even at depth 6) plus the live controls.
//
// One format, three consumers:
//   - share links:   /explorer.html#s=<encoded>   (deflate + base64url)
//   - local gallery: localStorage                  (same encoded string)
//   - featured.json: curated entries in the repo   (same encoded string)
// Tier 3 later (public submissions) POSTs this exact string to a serverless
// function — nothing here changes.

import type { ASTNode } from './ast';
import type { Controls } from './renderer';

export interface Snapshot {
  v: 1;
  ast: ASTNode;
  controls: Controls;
  seed: number;
  depth: number;
  mutations: number;
}

export interface GalleryEntry {
  id: string;
  title: string;
  created: number;   // epoch ms
  thumb: string;     // data URL (jpeg)
  data: string;      // encoded snapshot — the same string share links use
}

// --- encoding -------------------------------------------------------------
// "1." prefix = deflate-raw + base64url, "0." = plain base64url fallback
// (CompressionStream is in every browser you target, but the fallback keeps
// old links alive if you ever hit an environment without it).

function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(
    new Blob([bytes as BufferSource]).stream().pipeThrough(stream as ReadableWritablePair<Uint8Array, Uint8Array>),
  );
  return new Uint8Array(await out.arrayBuffer());
}

export async function encodeSnapshot(snap: Snapshot): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(snap));
  if (typeof CompressionStream !== 'undefined') {
    const packed = await pipe(bytes, new CompressionStream('deflate-raw'));
    return '1.' + b64urlEncode(packed);
  }
  return '0.' + b64urlEncode(bytes);
}

export async function decodeSnapshot(encoded: string): Promise<Snapshot | null> {
  try {
    const dot = encoded.indexOf('.');
    const scheme = encoded.slice(0, dot);
    const body = b64urlDecode(encoded.slice(dot + 1));
    const bytes = scheme === '1'
      ? await pipe(body, new DecompressionStream('deflate-raw'))
      : body;
    const snap = JSON.parse(new TextDecoder().decode(bytes)) as Snapshot;
    if (snap.v !== 1 || !snap.ast || !snap.controls) return null;
    return snap;
  } catch {
    return null; // corrupt / truncated link — caller falls back to a fresh shader
  }
}

export function shareUrl(encoded: string): string {
  return `${location.origin}/explorer.html#s=${encoded}`;
}

export function snapshotFromHash(): string | null {
  const m = location.hash.match(/[#&]s=([^&]+)/);
  return m ? m[1] : null;
}

// --- thumbnail ------------------------------------------------------------
// WebGPU swapchain textures are cleared after present, so the canvas must be
// read in the same frame it was drawn. Registering a one-off rAF works: the
// render loop's callback was queued first, so ours runs right after its draw.

export function captureThumb(source: HTMLCanvasElement, size = 200): Promise<string> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(source, 0, 0, size, size);
      resolve(c.toDataURL('image/jpeg', 0.75));
    });
  });
}

// --- local gallery --------------------------------------------------------

const LS_KEY = 'omar.shader.gallery';

export function loadGallery(): GalleryEntry[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as GalleryEntry[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveToGallery(entry: Omit<GalleryEntry, 'id' | 'created'>): GalleryEntry | null {
  const full: GalleryEntry = {
    ...entry,
    id: Math.random().toString(36).slice(2, 10),
    created: Date.now(),
  };
  const list = loadGallery();
  list.unshift(full);
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list));
    return full;
  } catch {
    // localStorage full (thumbs add up) — drop the oldest entries and retry once
    while (list.length > 1) {
      list.pop();
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(list));
        return full;
      } catch { /* keep shrinking */ }
    }
    return null;
  }
}

export function deleteFromGallery(id: string): void {
  const list = loadGallery().filter((e) => e.id !== id);
  localStorage.setItem(LS_KEY, JSON.stringify(list));
}
