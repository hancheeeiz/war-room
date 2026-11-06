// The shelf: documents the founder wants to reread on the page (learning notes, laws, decisions).
// .warroom/shelf.json keeps only a pointer to each file; the text is read from the project every time, so there is
// never a second copy to drift out of date. Every read is checked again, because shelf.json may come from elsewhere.
import fs from 'node:fs';
import path from 'node:path';

export const SHELF_MAX_BYTES = 1024 * 1024;
const MARKDOWN = /\.(md|markdown)$/i;

export function projectDir(store) {
  return path.dirname(store.root);
}

// A project-relative path to a Markdown file inside the project, or an error saying why not.
// Symlinks are followed before the check, so a link pointing outside the project is refused too.
export function resolveShelfPath(store, file) {
  const base = fs.realpathSync(projectDir(store));
  const want = path.resolve(base, String(file || ''));
  if (!MARKDOWN.test(want)) return { error: 'Only Markdown files (.md) go on the shelf.' };
  let real;
  try { real = fs.realpathSync(want); } catch { return { error: `No such file in the project: ${file}` }; }
  const rel = path.relative(base, real);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return { error: 'Only files inside this project folder can go on the shelf.' };
  if (rel.split(path.sep)[0] === '.warroom') return { error: 'War-room files cannot go on the shelf.' };
  const st = fs.statSync(real);
  if (!st.isFile()) return { error: `Not a file: ${file}` };
  if (st.size > SHELF_MAX_BYTES) return { error: 'The file is too big for the shelf (max 1 MB).' };
  return { rel: rel.split(path.sep).join('/'), abs: real };
}

export function readShelfItem(store, item) {
  const r = resolveShelfPath(store, item.path);
  if (r.error) return { error: r.error };
  return { text: fs.readFileSync(r.abs, 'utf8') };
}

export function firstHeading(text) {
  return String(text).match(/^\s{0,3}#{1,6}\s+(.+?)(?:\s+#+)?\s*$/m)?.[1];
}

// ── Markdown → HTML, enough for notes: headings, paragraphs, bold, italic, code, fenced code, tables,
// nested lists, quotes, rules and links. Everything is escaped first; no raw HTML from the file reaches the page.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const CODE_SPAN = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g;

function inline(text) {
  // Code spans are set aside first, so nothing inside them is formatted, while bold around them still works.
  const codes = [];
  const held = String(text).replace(/\u0000/g, '').replace(CODE_SPAN, (_, ticks, code) => {
    codes.push(`<code>${esc(code.trim() ? code.replace(/^ (.*) $/, '$1') : code)}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  return esc(held)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\[([^\]]+)\]\(([^)]*)\)/g, '<span class="md-link" title="$2">$1</span>')
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/__(?=\S)([\s\S]*?\S)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*\\])\*(?=\S)([^*]*?\S)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>')
    .replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, '$1')
    .replace(/\u0000(\d+)\u0000/g, (_, n) => codes[n]);
}

const LIST = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const FENCE = /^\s{0,3}(```+|~~~+)\s*([\w+-]*)/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const indentOf = (s) => s.match(/^\s*/)[0].replace(/\t/g, '    ').length;

// Split a table row on its pipes, but not on a pipe inside a code span or written as \|.
function cells(line) {
  const row = line.trim().replace(/^\|/, '');
  const out = [''];
  for (let i = 0, ticks = 0; i < row.length; i += 1) {
    const ch = row[i];
    if (ch === '\\' && row[i + 1] === '|') { out[out.length - 1] += '|'; i += 1; continue; }
    if (ch === '`') ticks ^= 1;
    if (ch === '|' && !ticks) out.push(''); else out[out.length - 1] += ch;
  }
  if (out.length > 1 && !out[out.length - 1].trim()) out.pop();
  return out.map((c) => c.trim());
}

function startsBlock(line, next) {
  return FENCE.test(line) || HEADING.test(line) || RULE.test(line) || /^\s{0,3}>/.test(line) || LIST.test(line)
    || (line.includes('|') && next !== undefined && TABLE_SEP.test(next) && next.includes('-'));
}

function blocks(lines) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }
    const fence = line.match(FENCE);
    if (fence) {
      const body = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i += 1;
      out.push(`<pre><code${fence[2] ? ` data-lang="${esc(fence[2])}"` : ''}>${esc(body.join('\n'))}</code></pre>`);
      continue;
    }
    const h = line.match(HEADING);
    if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i += 1; continue; }
    if (RULE.test(line)) { out.push('<hr>'); i += 1; continue; }
    if (line.includes('|') && lines[i + 1] !== undefined && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const head = cells(line);
      const align = cells(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : ''));
      const td = (tag, c, j) => `<${tag}${align[j] ? ` style="text-align:${align[j]}"` : ''}>${inline(c)}</${tag}>`;
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(cells(lines[i++]));
      out.push(`<div class="md-table"><table><thead><tr>${head.map((c, j) => td('th', c, j)).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${head.map((_, j) => td('td', r[j] ?? '', j)).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^\s{0,3}>/.test(line)) {
      const body = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i])) body.push(lines[i++].replace(/^\s{0,3}>\s?/, ''));
      out.push(`<blockquote>${blocks(body)}</blockquote>`);
      continue;
    }
    const li = line.match(LIST);
    if (li) {
      const base = indentOf(line);
      const ordered = /\d/.test(li[2]);
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(LIST);
        if (m && indentOf(lines[i]) === base && /\d/.test(m[2]) === ordered) { items.push({ n: parseInt(m[2], 10), body: [m[3]] }); i += 1; continue; }
        // Deeper lines (a sub-list or a continued item) belong to the item above; a blank line ends the list
        // unless the list carries on after it.
        if (lines[i].trim() && items.length && (indentOf(lines[i]) > base || (!m && !startsBlock(lines[i], lines[i + 1]) && lines[i - 1].trim()))) {
          items[items.length - 1].body.push(lines[i].slice(Math.min(indentOf(lines[i]), base + 2)));
          i += 1;
          continue;
        }
        if (!lines[i].trim() && lines[i + 1]?.match(LIST) && indentOf(lines[i + 1]) >= base) { i += 1; continue; }
        break;
      }
      const tag = ordered ? 'ol' : 'ul';
      const start = ordered && items[0].n !== 1 ? ` start="${items[0].n}"` : '';
      out.push(`<${tag}${start}>${items.map((it) => {
        const [first, ...more] = it.body;
        return `<li>${inline(first)}${more.length ? blocks(more) : ''}</li>`;
      }).join('')}</${tag}>`);
      continue;
    }
    // A paragraph: a line break in the file stays a line break, which suits Chinese text written one thought per line.
    const para = [];
    while (i < lines.length && lines[i].trim() && (!para.length || !startsBlock(lines[i], lines[i + 1]))) para.push(lines[i++].trim());
    out.push(`<p>${para.map(inline).join('<br>')}</p>`);
  }
  return out.join('\n');
}

export function markdownToHtml(text) {
  return blocks(String(text).replace(/\r\n?/g, '\n').replace(/^﻿/, '').split('\n'));
}
