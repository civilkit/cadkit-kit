// BM25F over named fields with CAD synonyms (half weight), simple stemming and edit-distance-1 typo tolerance.
import { SYNONYM_GROUPS } from './synonyms';

const STOP = new Set(['the', 'a', 'an', 'in', 'on', 'of', 'to', 'for', 'with', 'and', 'or', 'make', 'create', 'my', 'it', 'its', 'that', 'is', 'are', 'this', 'into', 'by', 'from', 'at', 'i', 'want', 'need', 'me', 'out', 'some', 'how', 'do', 'can', 'you', 'be', 'as', 'so', 'than', 'then', 'there', 'have', 'has', 'use', 'using', 'which', 'what', 'will', 'one', 'new', 'given', 'where', 'when', 'all']);

/** Simple suffix stripping. Applied to documents, queries and synonyms alike, so only consistency matters. */
export function stem(w: string): string {
  if (w.length <= 3) return w;
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
  if (w.endsWith('sses')) return w.slice(0, -2);
  if (w.endsWith('ing') && w.length > 5) { w = w.slice(0, -3); if (/([^aeiouls])\1$/.test(w)) w = w.slice(0, -1); return w; }
  if (w.endsWith('ed') && w.length > 4) { w = w.slice(0, -2); if (/([^aeiouls])\1$/.test(w)) w = w.slice(0, -1); return w; }
  if (/(ches|shes|xes|zes)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('es') && w.length > 4 && !/[aeiou]es$/.test(w.slice(-3)) ) return w.endsWith('ves') ? w : w.slice(0, -1);
  if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && w.length > 3) return w.slice(0, -1);
  if (w.endsWith('e') && w.length > 4) return w.slice(0, -1);
  return w;
}

/** camelCase and id separators split; lower-cased; stopwords dropped (keep with `keepStop`). */
export function tokenize(text: string, keepStop = false): string[] {
  const words = text.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return words.filter((w) => keepStop || !STOP.has(w)).map(stem);
}

export function editDistanceAtMostOne(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i);
}

// ---- synonyms: word groups, stemmed ----
const wordGroups = new Map<string, number[]>();           // stemmed single word -> group indexes
const phraseGroups: Array<{ phrase: string; group: number }> = [];
const groupWords: string[][] = SYNONYM_GROUPS.map((g, gi) => {
  const words: string[] = [];
  for (const m of g) {
    if (/[\s-]/.test(m.trim())) { phraseGroups.push({ phrase: m.toLowerCase(), group: gi }); for (const t of tokenize(m)) words.push(t); } else {
      const s = stem(m.toLowerCase());
      words.push(s);
      wordGroups.set(s, [...(wordGroups.get(s) ?? []), gi]);
    }
  }
  return [...new Set(words)];
});

/** Words related to the query by the synonym table: from single words of the query and from phrases found in it. Stemmed. */
export function synonymsOf(query: string): string[] {
  const out = new Set<string>();
  const q = ' ' + query.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ') + ' ';
  for (const t of tokenize(query, true)) for (const gi of wordGroups.get(t) ?? []) for (const w of groupWords[gi]) out.add(w);
  for (const { phrase, group } of phraseGroups) if (q.includes(' ' + phrase + ' ') || q.includes(' ' + phrase.replace(/-/g, ' ') + ' ')) for (const w of groupWords[group]) out.add(w);
  return [...out];
}

// ---- BM25F ----
export interface Doc { id: string; fields: Record<string, string>; meta?: Record<string, string> }
export interface Bm25fOptions { weights: Record<string, number>; k1?: number; b?: number }

export class Bm25f {
  private tf = new Map<string, Map<string, Record<string, number>>>();   // term -> doc id -> field -> tf
  private len = new Map<string, Record<string, number>>();
  private avg: Record<string, number> = {};
  private df = new Map<string, number>();
  private n: number;
  readonly vocab: string[];
  private k1: number; private b: number;
  constructor(private docs: Doc[], private opt: Bm25fOptions) {
    this.k1 = opt.k1 ?? 1.2; this.b = opt.b ?? 0.75;
    this.n = docs.length;
    for (const f of Object.keys(opt.weights)) this.avg[f] = 0;
    for (const d of docs) {
      const lens: Record<string, number> = {};
      const seen = new Set<string>();
      for (const f of Object.keys(opt.weights)) {
        const toks = tokenize(d.fields[f] ?? '');
        lens[f] = toks.length;
        this.avg[f] += toks.length / this.n;
        for (const t of toks) {
          let byDoc = this.tf.get(t); if (!byDoc) this.tf.set(t, (byDoc = new Map()));
          let byField = byDoc.get(d.id); if (!byField) byDoc.set(d.id, (byField = {}));
          byField[f] = (byField[f] ?? 0) + 1;
          seen.add(t);
        }
      }
      for (const t of seen) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      this.len.set(d.id, lens);
    }
    this.vocab = [...this.tf.keys()];
  }
  private termScore(term: string, id: string): number {
    const byField = this.tf.get(term)?.get(id);
    if (!byField) return 0;
    const lens = this.len.get(id)!;
    let tfw = 0;
    for (const [f, w] of Object.entries(this.opt.weights)) {
      const c = byField[f] ?? 0;
      if (!c) continue;
      tfw += w * c / (1 - this.b + this.b * (lens[f] / (this.avg[f] || 1)));
    }
    const df = this.df.get(term) ?? 0;
    const idf = Math.log(1 + (this.n - df + 0.5) / (df + 0.5));
    return idf * tfw / (this.k1 + tfw);
  }
  /** Rank documents for a query. Direct words count 1; a word that is only reached through the synonym table counts 0.5; a word not in the vocabulary is matched to vocabulary words at edit distance 1 (words longer than 4 letters only) at 0.9. */
  search(query: string, limit = 10): Array<{ id: string; score: number }> {
    const weights = new Map<string, number>();
    const put = (t: string, w: number) => weights.set(t, Math.max(weights.get(t) ?? 0, w));
    for (const t of tokenize(query)) {
      if (this.tf.has(t)) put(t, 1);
      else if (t.length > 4) { for (const v of this.vocab) if (v.length > 3 && editDistanceAtMostOne(t, v)) put(v, 0.9); } 
    }
    for (const s of synonymsOf(query)) if (this.tf.has(s) && !(weights.get(s) === 1)) put(s, 0.5);
    const out: Array<{ id: string; score: number }> = [];
    for (const d of this.docs) {
      let score = 0;
      for (const [t, w] of weights) score += w * this.termScore(t, d.id);
      if (score > 0) out.push({ id: d.id, score });
    }
    out.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    return out.slice(0, limit);
  }
}
