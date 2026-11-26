// Builds study data: Nave's Topical Bible (public domain; digital edition from BradyStephenson/bible-data, CC BY 4.0),
// Hitchcock's Bible Names (same source) and Easton's Bible Dictionary (1897, public domain; via Theographic).
// Usage: node tools/build-study.mjs /tmp/bdata /tmp/theo   → data/topics/*, data/dict/*
import fs from 'node:fs';
const [bdata = '/tmp/bdata', theo = '/tmp/theo'] = process.argv.slice(2);
const books = JSON.parse(fs.readFileSync('data/concordance/books.json', 'utf8')).map(b => b[1]);
const CODES = ['GEN','EXO','LEV','NUM','DEU','JOS','JDG','RUT','1SA','2SA','1KI','2KI','1CH','2CH','EZR','NEH','EST','JOB','PSA','PRO','ECC','SNG','ISA','JER','LAM','EZK','DAN','HOS','JOL','AMO','OBA','JON','MIC','NAM','HAB','ZEP','HAG','ZEC','MAL','MAT','MRK','LUK','JHN','ACT','ROM','1CO','2CO','GAL','EPH','PHP','COL','1TH','2TH','1TI','2TI','TIT','PHM','HEB','JAS','1PE','2PE','1JN','2JN','3JN','JUD','REV'];
const ALT = { SOS: 'SNG', SOL: 'SNG', EZE: 'EZK', JOE: 'JOL', NAH: 'NAM', PHI: 'PHP', JDE: 'JUD', JUDE: 'JUD', PSM: 'PSA', MAR: 'MRK', MAK: 'MRK', JOH: 'JHN', JAM: 'JAS' };
const NAME = Object.fromEntries(CODES.map((c, i) => [c, books[i]]));
// CSV parser (quoted fields with newlines)
function csv(text) { const rows = []; let row = [], f = '', q = false; text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; } else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; } else if (c !== '\r') f += c; }
  if (f || row.length) { row.push(f); rows.push(row); } const h = rows.shift(); return rows.map(r => Object.fromEntries(h.map((k, i) => [k, r[i] || '']))); }
// "EXO 6:16-20; JOS 21:4,10; 1CH 6:2,3; 23:13" → ["Exodus 6:16-20","Joshua 21:4","Joshua 21:10",...]
function refs(s) { const out = []; let book = null, ch = null;
  for (const part of s.split(/;\s*/)) { let p = part.trim(); if (!p) continue;
    const m = p.match(/^([1-3]?[A-Za-z]{2,4})\s+(.*)$/); if (m) { const c = m[1].toUpperCase(); const code = NAME[c] ? c : ALT[c]; if (!code) continue; book = code; p = m[2]; }
    if (!book) continue;
    for (const piece of p.split(/,\s*/)) { const cm = piece.match(/^(\d+):(\d+(?:-\d+)?)$/); const vm = piece.match(/^(\d+(?:-\d+)?)$/);
      if (cm) { ch = cm[1]; out.push(`${NAME[book]} ${ch}:${cm[2]}`); } else if (vm && ch) out.push(`${NAME[book]} ${ch}:${vm[1]}`); else if (/^\d+$/.test(piece)) { ch = piece; out.push(`${NAME[book]} ${piece}`); } } }
  return out; }
// ---- Nave's
const naves = csv(fs.readFileSync(`${bdata}/NavesTopicalDictionary.csv`, 'utf8'));
const T = {}, tindex = [];
for (const r of naves) { const subj = r.subject.trim(); if (!subj) continue;
  const lines = r.entry.split('\n').map(l => { const ind = (l.match(/^\s*/)[0].length >= 4) ? 1 : 0; let t = l.trim().replace(/^-/, '').replace(/\[\d+\]/g, '').trim(); if (!t) return null;
    const see = t.match(/^See\s+(.+)$/i); if (see) return [ind, '', [], see[1].split(/;\s*/).map(x => x.trim())];
    const m = /(?:^|\s)((?:[1-3]?[A-Z]{2,4}|Jude)\s+\d+:\d)/.exec(t);
    if (!m) return [ind, t, []]; const at = m.index + (m[0].length - m[1].length);
    const r = refs(t.slice(at)); return r.length ? [ind, t.slice(0, at).replace(/[,;:]\s*$/, '').trim(), r] : [ind, t, []]; }).filter(Boolean);
  const L = subj[0].toUpperCase().replace(/[^A-Z]/, 'X'); (T[L] ||= {})[subj] = lines;
  tindex.push([subj, lines.reduce((s, l) => s + l[2].length, 0), L]); }
fs.mkdirSync('data/topics', { recursive: true });
for (const [L, m] of Object.entries(T)) fs.writeFileSync(`data/topics/${L}.json`, JSON.stringify(m));
fs.writeFileSync('data/topics/index.json', JSON.stringify(tindex));
// ---- Easton's + Hitchcock's
const hitch = csv(fs.readFileSync(`${bdata}/HitchcocksBibleNamesDictionary.csv`, 'utf8')).map(r => [r.Name.trim(), r.Meaning.trim()]).filter(r => r[0]);
const east = JSON.parse(fs.readFileSync(`${theo}/json/easton.json`, 'utf8')).map(r => r.fields);
const D = {}, dindex = [];
for (const e of east) { const term = (e.termLabel || '').trim(); if (!term) continue; const txt = String(e.dictText || '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim();
  const L = term[0].toUpperCase().replace(/[^A-Z]/, 'X'); const k = term.toLowerCase(); ((D[L] ||= {})[k] ||= { t: term, e: [] }).e.push(txt); }
for (const [n, m] of hitch) { const L = n[0].toUpperCase().replace(/[^A-Z]/, 'X'); const k = n.toLowerCase(); ((D[L] ||= {})[k] ||= { t: n, e: [] }).h = m; }
fs.mkdirSync('data/dict', { recursive: true });
for (const [L, m] of Object.entries(D)) { fs.writeFileSync(`data/dict/${L}.json`, JSON.stringify(m)); for (const [k, v] of Object.entries(m)) dindex.push([v.t, L, v.h ? 1 : 0, v.e.length]); }
fs.writeFileSync('data/dict/index.json', JSON.stringify(dindex.sort((a, b) => a[0].localeCompare(b[0]))));
console.log(`Topics: ${tindex.length}; dictionary terms: ${dindex.length} (Hitchcock names: ${hitch.length})`);
