// Gallery — saved shaders as cards. Two sources, same snapshot format:
//   featured.json  (curated, ships with the repo, served from public/)
//   localStorage   (whatever this visitor saved in the explorer)
// Every card opens in the explorer via the same #s= share link mechanism,
// so "open" and "share" are literally the same URL.

import {
  loadGallery, deleteFromGallery, shareUrl, decodeSnapshot,
  type GalleryEntry,
} from './snapshot';
import { analyzeAST } from './analyzer';

interface FeaturedEntry {
  title: string;
  data: string;
  thumb?: string; // data URL or a path like /thumbs/foo.jpg — optional
}

const featuredGrid = document.getElementById('featured-grid') as HTMLDivElement;
const localGrid = document.getElementById('local-grid') as HTMLDivElement;
const localEmpty = document.getElementById('local-empty') as HTMLDivElement;

function fmtDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

async function statsLine(data: string): Promise<string> {
  const snap = await decodeSnapshot(data);
  if (!snap) return 'unreadable snapshot';
  const stats = analyzeAST(snap.ast);
  const mut = snap.mutations > 0 ? ` · ${snap.mutations} mut` : '';
  return `seed ${snap.seed} · depth ${snap.depth} · ${stats.nodeCount} nodes${mut}`;
}

function makeCard(opts: {
  title: string;
  data: string;
  thumb?: string;
  meta?: string;
  onDelete?: () => void;
  exportable?: boolean;
}): HTMLElement {
  const card = document.createElement('div');
  card.className = 'card';

  const link = shareUrl(opts.data);

  const thumbHtml = opts.thumb
    ? `<img class="thumb" src="${opts.thumb}" alt="" loading="lazy" />`
    : `<div class="thumb thumb-empty">no preview</div>`;

  card.innerHTML = `
    <a class="thumb-link" href="${link}">${thumbHtml}</a>
    <div class="card-body">
      <div class="card-title">${opts.title}</div>
      <div class="card-meta">${opts.meta ?? ''}</div>
      <div class="card-stats">…</div>
      <div class="card-actions">
        <a class="card-btn" href="${link}">open</a>
        <button class="card-btn" data-act="copy">copy link</button>
        ${opts.exportable ? '<button class="card-btn" data-act="export">export card</button>' : ''}
        ${opts.onDelete ? '<button class="card-btn danger" data-act="delete">delete</button>' : ''}
      </div>
    </div>
  `;

  const statsDiv = card.querySelector('.card-stats') as HTMLDivElement;
  statsLine(opts.data).then((s) => { statsDiv.textContent = s; });

  const flash = (btn: HTMLButtonElement, text: string) => {
    const orig = btn.textContent;
    btn.textContent = text;
    setTimeout(() => { btn.textContent = orig; }, 1200);
  };

  card.querySelector('[data-act="copy"]')?.addEventListener('click', (e) => {
    navigator.clipboard.writeText(link);
    flash(e.currentTarget as HTMLButtonElement, 'copied');
  });

  // "export card" copies a featured.json-ready entry to the clipboard, so
  // curating the featured section is paste-into-repo, nothing else.
  card.querySelector('[data-act="export"]')?.addEventListener('click', (e) => {
    const entry: FeaturedEntry = { title: opts.title, data: opts.data, thumb: opts.thumb };
    navigator.clipboard.writeText(JSON.stringify(entry, null, 2));
    flash(e.currentTarget as HTMLButtonElement, 'copied JSON');
  });

  card.querySelector('[data-act="delete"]')?.addEventListener('click', () => {
    opts.onDelete?.();
    card.remove();
    renderLocalEmptyState();
  });

  return card;
}

function renderLocalEmptyState() {
  const empty = loadGallery().length === 0;
  localEmpty.style.display = empty ? 'block' : 'none';
}

function renderLocal() {
  localGrid.innerHTML = '';
  for (const entry of loadGallery()) {
    localGrid.appendChild(makeCard({
      title: entry.title,
      data: entry.data,
      thumb: entry.thumb,
      meta: fmtDate(entry.created),
      exportable: true,
      onDelete: () => deleteFromGallery(entry.id),
    }));
  }
  renderLocalEmptyState();
}

async function renderFeatured() {
  try {
    const res = await fetch('/featured.json');
    if (!res.ok) throw new Error(String(res.status));
    const json = (await res.json()) as { shaders?: FeaturedEntry[] };
    const shaders = json.shaders ?? [];
    if (shaders.length === 0) {
      (document.getElementById('featured-section') as HTMLElement).style.display = 'none';
      return;
    }
    for (const entry of shaders) {
      featuredGrid.appendChild(makeCard({
        title: entry.title,
        data: entry.data,
        thumb: entry.thumb,
      }));
    }
  } catch {
    // no featured.json deployed — hide the section rather than showing an error
    (document.getElementById('featured-section') as HTMLElement).style.display = 'none';
  }
}

renderLocal();
renderFeatured();
