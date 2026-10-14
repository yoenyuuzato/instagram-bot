import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

let _db: NeonHttpDatabase<typeof schema> | null = null;

/** Líná inicializace – build nepotřebuje DATABASE_URL. */
export function getDb() {
  if (!_db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("Chybí DATABASE_URL");
    _db = drizzle(neon(url), { schema });
  }
  return _db;
}

export { schema };
