// リプレイ・共有クリップのプレビュー再生。書き出しは encode.ts。

export interface PlaybackHandle {
  readonly stop: () => void;
  /** 最後まで再生すると解決する。stop() で止めたときも解決する。 */
  readonly finished: Promise<void>;
}

/** 経過時間（ミリ秒）を受け取ってその瞬間の絵を描く */
export type Drawer = (elapsedMs: number) => void;

/** speed() は毎フレーム読むので、再生中の速度変更が反映される */
export function play(draw: Drawer, duration: number, speed: () => number): PlaybackHandle {
  const state = { elapsed: 0, last: performance.now(), frameId: 0, stopped: false };
  const finished = new Promise<void>((resolve) => {
    const tick = (now: number): void => {
      if (state.stopped) return resolve();
      state.elapsed = Math.min(duration, state.elapsed + (now - state.last) * speed());
      state.last = now;
      draw(state.elapsed);
      if (state.elapsed >= duration) return resolve();
      state.frameId = requestAnimationFrame(tick);
    };
    draw(0);
    state.frameId = requestAnimationFrame(tick);
  });
  return {
    finished,
    stop: (): void => {
      state.stopped = true;
      cancelAnimationFrame(state.frameId);
    },
  };
}
