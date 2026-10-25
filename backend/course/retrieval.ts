// Adapted from the copied Agent project BM25 module; course tokenizer keeps Latin terms intact.
/**
 * 稀疏检索通道：中文分词 + BM25Okapi。
 *
 * BM25 擅长精确术语匹配（如装置型号"PCS-931"），与稠密通道形成互补。
 */

import nodejieba from 'nodejieba';

/** BM25 可调参数：k1 控制词频饱和，b 控制文档长度归一化强度 */
const K1 = 1.5;
const B = 0.75;

/** 过滤纯标点与空白，避免污染倒排统计 */
const MEANINGLESS = /^[\s\p{P}\p{S}]+$/u;

export interface ScoredId {
  id: string;
  score: number;
}

export class SparseIndex {
  private ids: string[] = [];
  private docs: string[][] = [];
  private docFreq = new Map<string, number>();
  private avgDocLength = 0;

  /** 分词并过滤无意义片段 */
  private tokenize(text: string): string[] {
    const stop = new Set(['什么','如何','怎么','为什么','请问','一个','可以','进行','需要','哪些','是否','我们','作用']);
    const groups = text.toLowerCase().match(/[a-z0-9_]+|[\u3400-\u9fff]+/g) ?? [];
    return groups.flatMap(group => /^[a-z0-9_]+$/.test(group) ? [group] : nodejieba.cut(group, false))
      .filter(t => !MEANINGLESS.test(t) && !stop.has(t) && (t.length > 1 || /^[a-z0-9]$/.test(t))); 
  }

  /** 全量重建索引（条目规模为百级，重建成本可忽略） */
  build(ids: string[], texts: string[]): void {
    this.ids = ids;
    this.docs = texts.map(t => this.tokenize(t));
    this.docFreq.clear();

    let totalLength = 0;
    for (const doc of this.docs) {
      totalLength += doc.length;
      for (const term of new Set(doc)) {
        this.docFreq.set(term, (this.docFreq.get(term) ?? 0) + 1);
      }
    }
    this.avgDocLength = this.docs.length > 0 ? totalLength / this.docs.length : 0;
  }

  /** 逆文档频率，含平滑项避免除零 */
  private idf(term: string): number {
    const n = this.ids.length;
    const df = this.docFreq.get(term) ?? 0;
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
  }

  /** 返回得分最高的前 topK 条（得分为 0 的不返回） */
  search(query: string, topK: number): ScoredId[] {
    const terms = this.tokenize(query);
    if (terms.length === 0) return [];

    const scored: ScoredId[] = [];
    for (let i = 0; i < this.docs.length; i++) {
      const doc = this.docs[i]!;
      const docLength = doc.length;
      let score = 0;
      for (const term of terms) {
        let tf = 0;
        for (const w of doc) if (w === term) tf++;
        if (tf === 0) continue;
        const norm = 1 - B + B * (docLength / (this.avgDocLength || 1));
        score += this.idf(term) * ((tf * (K1 + 1)) / (tf + K1 * norm));
      }
      if (score > 0) scored.push({ id: this.ids[i]!, score });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  get size(): number {
    return this.ids.length;
  }
}
