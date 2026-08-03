/**
 * Boomtown Platform — in-memory D1 shim for the end-to-end harness
 * File: worker/test/helpers/d1-memory.mjs · Version: v1.0 · Date: 2026-08-02 · Ships in: v0.57.0
 *
 * WHY
 * The 683-test suite is broad but unit- and guard-shaped: it proves individual functions and
 * scans source. Nothing exercised the actual operating loop — signup → register → pay → check in
 * → play → notify — through the real router, against real SQL, in order. Every defect this
 * platform has shipped that mattered lived in the SEAMS: a module built and never mounted, a
 * predicate written twice and drifted, a claim link that expired six hours late. Seams are
 * exactly what unit tests do not touch.
 *
 * WHAT THIS IS
 * A minimal implementation of the Cloudflare D1 binding API over `node:sqlite`, so the worker's
 * real `export default { fetch }` can run in-process against a real SQLite database with the real
 * production schema. No network, no wrangler, no mocking of the code under test — only the
 * database binding is substituted, and it is substituted for a genuine SQL engine rather than a
 * fake that agrees with whatever the caller expects.
 *
 * `node:sqlite` is built in and needs no flag on Node 22.23.2 (CI's pin) and Node 24.18.1 —
 * verified 2026-08-02. On 22 it prints an ExperimentalWarning, which is noise, not failure.
 *
 * THE SURFACE, measured rather than guessed (grep over worker/src on 2026-08-02):
 *   DB.prepare  ×718 · DB.batch ×5 · .first() ×254 · .all() ×170 · .run() ×288
 *   .meta.last_row_id ×69 · .meta.changes ×23
 * That is the whole contract. Anything outside it throws loudly here rather than returning
 * undefined and letting a test pass for the wrong reason.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * Foreign keys stay OFF, which is also D1's default. That is what lets the journey fixture carry
 * only the 14 tables the loop touches instead of all 82: a REFERENCES clause pointing at an absent
 * table is inert. If a route reaches a table the fixture does not define, SQLite raises
 * "no such table" — a loud, precise failure, which is the correct outcome. It is not a silent pass.
 */

import { DatabaseSync } from "node:sqlite";

/** D1 hands back plain objects; node:sqlite returns null-prototype rows and may return BigInt. */
function normalizeRow(row) {
  if (!row) return null;
  const out = {};
  for (const k of Object.keys(row)) {
    const v = row[k];
    out[k] = typeof v === "bigint" ? Number(v) : v;
  }
  return out;
}

class D1PreparedStatement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  /** D1 returns a NEW statement rather than mutating — reusing a prepared statement is legal. */
  bind(...params) {
    return new D1PreparedStatement(this.db, this.sql, params);
  }

  #stmt() {
    try {
      return this.db.prepare(this.sql);
    } catch (e) {
      throw new Error(`d1-memory: could not prepare SQL — ${e.message}\n  ${this.sql.slice(0, 300)}`);
    }
  }

  async first(column) {
    const row = normalizeRow(this.#stmt().get(...this.params));
    if (row && column !== undefined) return row[column];
    return row;
  }

  async all() {
    const results = this.#stmt().all(...this.params).map(normalizeRow);
    return { success: true, results, meta: { changes: 0, last_row_id: 0, rows_read: results.length } };
  }

  async run() {
    const r = this.#stmt().run(...this.params);
    return {
      success: true,
      results: [],
      meta: {
        changes: Number(r.changes),
        // D1 spells it last_row_id; node:sqlite spells it lastInsertRowid. The 69 call sites
        // that read .meta.last_row_id are why this mapping is not optional.
        last_row_id: Number(r.lastInsertRowid),
      },
    };
  }
}

class D1Memory {
  constructor(schemaSql) {
    this.db = new DatabaseSync(":memory:");
    // Foreign keys stay off, matching D1's default and letting the fixture stay narrow.
    this.db.exec("PRAGMA foreign_keys = OFF");
    if (schemaSql) this.db.exec(schemaSql);
  }

  prepare(sql) {
    return new D1PreparedStatement(this.db, sql);
  }

  /** D1 runs a batch atomically and returns one result per statement, in order. */
  async batch(statements) {
    this.db.exec("BEGIN");
    try {
      const out = [];
      for (const st of statements) out.push(await st.run());
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  /** Test-side escape hatch — never used by worker code, only to seed and to assert. */
  exec(sql) { this.db.exec(sql); }
  query(sql, ...params) { return this.db.prepare(sql).all(...params).map(normalizeRow); }
  one(sql, ...params) { return normalizeRow(this.db.prepare(sql).get(...params)); }
  close() { this.db.close(); }
}

export function createD1(schemaSql) {
  return new D1Memory(schemaSql);
}
