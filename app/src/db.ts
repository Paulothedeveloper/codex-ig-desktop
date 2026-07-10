// Acesso ao SQLite local (tauri-plugin-sql). Snapshots pro gráfico de crescimento + quem-saiu.
import Database from "@tauri-apps/plugin-sql";

let _db: Database | null = null;
async function getDb(): Promise<Database> {
  if (!_db) _db = await Database.load("sqlite:codexig.db");
  return _db;
}

export async function ensureAccount(igUserId: string, username = ""): Promise<number> {
  const db = await getDb();
  await db.execute("INSERT OR IGNORE INTO account (ig_user_id, username, added_at) VALUES (?, ?, ?)", [igUserId, username, Date.now()]);
  const rows = await db.select<{ id: number }[]>("SELECT id FROM account WHERE ig_user_id = ?", [igUserId]);
  return rows[0].id;
}

// grava 1 snapshot/dia (atualiza o do dia se já existe)
export async function saveSnapshot(accountId: number, followingCount: number, followersCount: number, followersPks: string[]) {
  const db = await getDb();
  const today = new Date().toISOString().slice(0, 10);
  const fj = JSON.stringify(followersPks);
  const last = await db.select<{ id: number; ts: number }[]>("SELECT id, ts FROM snapshot WHERE account_id = ? ORDER BY ts DESC LIMIT 1", [accountId]);
  if (last.length && new Date(last[0].ts).toISOString().slice(0, 10) === today) {
    await db.execute("UPDATE snapshot SET ts=?, following_count=?, followers_count=?, followers_json=? WHERE id=?", [Date.now(), followingCount, followersCount, fj, last[0].id]);
  } else {
    await db.execute("INSERT INTO snapshot (account_id, ts, following_count, followers_count, followers_json) VALUES (?,?,?,?,?)", [accountId, Date.now(), followingCount, followersCount, fj]);
  }
}

export async function growthSeries(accountId: number): Promise<{ ts: number; followers: number }[]> {
  const db = await getDb();
  const rows = await db.select<{ ts: number; followers_count: number }[]>("SELECT ts, followers_count FROM snapshot WHERE account_id = ? ORDER BY ts ASC", [accountId]);
  return rows.map((r) => ({ ts: r.ts, followers: r.followers_count }));
}

// diff dos 2 últimos snapshots: quantos saíram / chegaram
export async function whoLeft(accountId: number): Promise<{ lost: number; gained: number; prevTs: number | null }> {
  const db = await getDb();
  const rows = await db.select<{ ts: number; followers_json: string }[]>("SELECT ts, followers_json FROM snapshot WHERE account_id = ? ORDER BY ts DESC LIMIT 2", [accountId]);
  if (rows.length < 2) return { lost: 0, gained: 0, prevTs: null };
  const cur = new Set<string>(JSON.parse(rows[0].followers_json || "[]"));
  const prev = new Set<string>(JSON.parse(rows[1].followers_json || "[]"));
  let lost = 0, gained = 0;
  prev.forEach((p) => { if (!cur.has(p)) lost++; });
  cur.forEach((c) => { if (!prev.has(c)) gained++; });
  return { lost, gained, prevTs: rows[1].ts };
}
