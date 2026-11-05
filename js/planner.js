// KE30minutos  planner.js  版 0.4.1  基づく仕様書：KE30minutos_仕様書_v0.4.1.md
// 役割：指定時間（最低）〜指定時間＋許容幅（最大）に収まるように、曲順を最後まで決める。
//       メインの曲を順に引き、最後に「ラストの曲」を1つ置く。乱数は引数で差し替えられる（検証用）。

const Planner = {
  // 配列をかき混ぜた新しい配列を返す（元の配列は変えない）
  shuffle_(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  },

  // 合計時間が許容範囲の外へ、どれだけ離れているか（範囲内なら0）。足りないほうを2倍重く見る
  distance_(total, target, tol) {
    if (total < target) return (target - total) * 2;
    if (total > target + tol) return total - (target + tol);
    return 0;
  },

  // opts: { mainPool, lastPool, targetSec, toleranceSec, fixedSec, excludeIds, rng, maxTries }
  //   mainPool / lastPool の要素：{ id, effSec }（effSec＝実際に聞く時間＋つなぎの時間。秒）
  //   fixedSec：すでに決まっている時間（聞いた時間＋今の曲の残り）。最初の組み立てでは 0
  //   excludeIds：選ばない曲（聞き終えた曲・今の曲）
  // 戻り値：{ ids, lastId, totalSec, inRange, repeated, phase }
  plan(opts) {
    const rng = opts.rng || Math.random;
    const target = opts.targetSec;
    const tol = opts.toleranceSec;
    const fixed = opts.fixedSec || 0;
    const maxTries = opts.maxTries || 300;
    const exclude = new Set(opts.excludeIds || []);
    const mainAll = opts.mainPool.filter((s) => !exclude.has(s.id));
    const lastAll = opts.lastPool.filter((s) => !exclude.has(s.id));
    const need = target - fixed;            // これから足す必要がある最低の時間
    let best = null;

    // 段階：1＝曲を重ねない・範囲を飛び越えない／2＝重ねてよい・飛び越えない／3＝重ねてよい・飛び越えてもよい
    for (let phase = 1; phase <= 3; phase++) {
      for (let t = 0; t < maxTries; t++) {
        const f = lastAll.length ? lastAll[Math.floor(rng() * lastAll.length)] : null;
        const fSec = f ? f.effSec : 0;
        const lo = need - fSec;
        const hi = need + tol - fSec;
        const base = mainAll.filter((s) => !f || s.id !== f.id);
        if (!base.length && lo > 0) continue;
        let pool = this.shuffle_(base, rng);
        const seq = [];
        let S = 0;
        let prev = null;
        let ok = true;
        let repeated = false;
        while (S < lo) {
          let idx = pool.findIndex((s) => phase === 3 || S + s.effSec <= hi);
          if (idx < 0) {
            if (phase === 1) { ok = false; break; }
            pool = this.shuffle_(base, rng);                       // 足りない：全曲を入れ直す
            if (base.length > 1 && prev && pool[0].id === prev.id) pool.push(pool.shift());
            repeated = true;
            idx = pool.findIndex((s) => phase === 3 || S + s.effSec <= hi);
            if (idx < 0) { ok = false; break; }
          }
          const s = pool.splice(idx, 1)[0];
          seq.push(s);
          S += s.effSec;
          prev = s;
        }
        if (!ok) continue;
        const total = fixed + S + fSec;
        const d = this.distance_(total, target, tol);
        const ids = seq.map((s) => s.id).concat(f ? [f.id] : []);
        const cand = { ids, lastId: f ? f.id : null, totalSec: total, inRange: d === 0, repeated, phase, dist_: d };
        if (d === 0) return cand;
        if (!best || d < best.dist_) best = cand;
      }
    }
    return best || { ids: [], lastId: null, totalSec: fixed, inRange: false, repeated: false, phase: 3, dist_: Infinity };
  },
};

if (typeof module !== 'undefined') module.exports = { Planner };
