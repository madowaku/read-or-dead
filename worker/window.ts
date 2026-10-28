// 時間枠ごとの回数を数える（Durable Object「Limiter」の中身）。テストでは Node の SQLite を差し込む。

import type { SqlRunner } from "./relay";

/** 決まった長さの時間枠ごとに数える。枠が変わったら 0 からやり直す */
export class WindowCounter {
  constructor(private readonly sql: SqlRunner) {
    sql.exec("CREATE TABLE IF NOT EXISTS window (id INTEGER PRIMARY KEY CHECK (id = 1), started_at INTEGER NOT NULL, count INTEGER NOT NULL)");
  }

  /** 1 回分を使う。上限に達していたら false（数えない） */
  take(limit: number, windowMs: number, now: number): boolean {
    const row = this.sql.exec("SELECT started_at, count FROM window WHERE id = 1").toArray()[0];
    const startedAt = typeof row?.started_at === "number" ? row.started_at : 0;
    const count = typeof row?.count === "number" ? row.count : 0;
    // まだ一度も数えていないか、前の枠が終わっていれば新しい枠を始める
    const fresh = !row || now - startedAt >= windowMs;
    if (!fresh && count >= limit) return false;
    this.sql.exec(
      "INSERT INTO window (id, started_at, count) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET started_at = excluded.started_at, count = excluded.count",
      fresh ? now : startedAt,
      fresh ? 1 : count + 1,
    );
    return true;
  }
}
