function softmax(x: number[]): number[] {
  let max = x[0];
  for (let i = 1; i < x.length; i++) if (x[i] > max) max = x[i];
  const ex = x.map((v) => Math.exp(v - max));
  const s = ex.reduce((a, b) => a + b, 0);
  return ex.map((v) => v / s);
}

function glorot(ni: number, no: number): number {
  const lim = Math.sqrt(6 / (ni + no));
  return (Math.random() * 2 - 1) * lim;
}

export function oneHot(idx: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => (i === idx ? 1 : 0));
}

export class Net {
  readonly dims: number[];
  readonly lr: number;
  W: number[][][];
  b: number[][];

  constructor(dims: number[], lr = 0.02) {
    this.dims = dims;
    this.lr = lr;
    this.W = [];
    this.b = [];
    for (let l = 0; l < dims.length - 1; l++) {
      const ni = dims[l];
      const no = dims[l + 1];
      const wl: number[][] = [];
      for (let i = 0; i < ni; i++) {
        const row: number[] = [];
        for (let j = 0; j < no; j++) row.push(glorot(ni, no));
        wl.push(row);
      }
      this.W.push(wl);
      this.b.push(new Array(no).fill(0));
    }
  }

  forward(x: number[]): { a: number[][]; z: number[][] } {
    const a: number[][] = [x.slice()];
    const z: number[][] = [];
    for (let l = 0; l < this.W.length; l++) {
      const ni = this.W[l].length;
      const no = this.W[l][0].length;
      const zi: number[] = [];
      for (let j = 0; j < no; j++) {
        let sum = this.b[l][j];
        for (let i = 0; i < ni; i++) sum += a[l][i] * this.W[l][i][j];
        zi.push(sum);
      }
      z.push(zi);
      if (l === this.W.length - 1) {
        a.push(softmax(zi));
      } else {
        a.push(zi.map((v) => (v > 0 ? v : 0)));
      }
    }
    return { a, z };
  }

  predict(x: number[]): number[] {
    const res = this.forward(x);
    return res.a[res.a.length - 1];
  }

  train(X: number[][], Y: number[][]): number {
    const L = this.W.length;
    const dW: number[][][] = [];
    const db: number[][] = [];
    for (let l = 0; l < L; l++) {
      const ni = this.W[l].length;
      const no = this.W[l][0].length;
      dW.push(Array.from({ length: ni }, () => new Array(no).fill(0)));
      db.push(new Array(no).fill(0));
    }

    let totalLoss = 0;

    for (let s = 0; s < X.length; s++) {
      const { a, z } = this.forward(X[s]);
      const y = Y[s];
      const pred = a[L];

      for (let i = 0; i < pred.length; i++) {
        totalLoss -= y[i] * Math.log(Math.max(pred[i], 1e-15));
      }

      let delta = pred.map((p, i) => p - y[i]);

      for (let l = L - 1; l >= 0; l--) {
        const ni = a[l].length;
        for (let i = 0; i < ni; i++) {
          for (let j = 0; j < delta.length; j++) {
            dW[l][i][j] += a[l][i] * delta[j];
          }
        }
        for (let j = 0; j < delta.length; j++) db[l][j] += delta[j];

        if (l > 0) {
          const newDelta: number[] = [];
          for (let i = 0; i < a[l].length; i++) {
            if (z[l - 1][i] > 0) {
              let sum2 = 0;
              for (let j = 0; j < delta.length; j++) sum2 += delta[j] * this.W[l][i][j];
              newDelta.push(sum2);
            } else {
              newDelta.push(0);
            }
          }
          delta = newDelta;
        }
      }
    }

    const n = X.length;
    for (let l = 0; l < L; l++) {
      for (let i = 0; i < this.W[l].length; i++) {
        for (let j = 0; j < this.W[l][i].length; j++) {
          this.W[l][i][j] -= (this.lr * dW[l][i][j]) / n;
        }
      }
      for (let j = 0; j < this.b[l].length; j++) {
        this.b[l][j] -= (this.lr * db[l][j]) / n;
      }
    }

    return totalLoss / n;
  }
}

export const vowelNet = new Net([13, 16, 8, 6]);

export interface TrainingBuffer {
  X: number[][];
  Y: number[][];
}

export const trainingBuffer: TrainingBuffer = { X: [], Y: [] };
