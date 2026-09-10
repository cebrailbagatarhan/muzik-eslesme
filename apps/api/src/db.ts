import { readFile,readdir,mkdir,open,unlink } from 'node:fs/promises';
import { dirname,resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
export type Row = Record<string, any>;
export interface Query { query<T extends Row = Row>(sql: string, values?: any[]): Promise<T[]>; }
export interface Database extends Query { tx<T>(work: (q: Query) => Promise<T>): Promise<T>; close(): Promise<void>; }
export async function openDatabase(url = '', dataDir?: string): Promise<Database> {
  let directory = new URL('../migrations/',import.meta.url);
  try { await readdir(directory); } catch { directory=new URL('../../migrations/',import.meta.url); }
  const names=(await readdir(directory)).filter(n=>/^\d+.*\.sql$/.test(n)).sort();
  const migrations=await Promise.all(names.map(async name=>({name,sql:await readFile(new URL(name,directory),'utf8')})));
  async function migrate(q:Query,exec:(sql:string)=>Promise<unknown>) {
    await exec('CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');
    const done=new Set((await q.query('SELECT version FROM schema_migrations')).map(r=>r.version));
    for(const m of migrations)if(!done.has(m.name)){
      await exec(m.sql);await q.query('INSERT INTO schema_migrations(version) VALUES($1)',[m.name]);
    }
  }
  if (url) {
    const pool = new pg.Pool({ connectionString: url, max: 12, connectionTimeoutMillis: 5000, statement_timeout: 15000 });
    const setup = await pool.connect();
    try {
      await setup.query('BEGIN');
      await setup.query('SELECT pg_advisory_xact_lock(617482901)');
      await migrate({query:async(sql,values=[]) => (await setup.query(sql,values)).rows},sql=>setup.query(sql));
      await setup.query('COMMIT');
    } catch(e) { await setup.query('ROLLBACK'); throw e; } finally { setup.release(); }
    return {
      query: async (sql, values = []) => (await pool.query(sql, values)).rows,
      async tx(work) {
        for (let attempt=0;;attempt++) {
          const client = await pool.connect();
          try {
            await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
            const result = await work({ query: async (sql, values=[]) => (await client.query(sql,values)).rows });
            await client.query('COMMIT'); return result;
          } catch (e: any) {
            await client.query('ROLLBACK');
            if (!['40001','40P01'].includes(e.code) || attempt >= 4) throw e;
          } finally { client.release(); }
        }
      },
      close: () => pool.end(),
    };
  }
  let lockFile:string|undefined;
  if(dataDir){
    const directory=resolve(dataDir);await mkdir(dirname(directory),{recursive:true});lockFile=`${directory}.lock`;
    try{
      const handle=await open(lockFile,'wx',0o600);await handle.writeFile(String(process.pid));await handle.close();
    }catch(e:any){
      if(e.code==='EEXIST')throw new Error('Yerel PGlite başka bir işlem tarafından kullanılıyor. Seed veya moderator komutundan önce API sunucusunu durdur. Beklenmedik kapanıştan kalan .lock dosyasını ancak başka işlem çalışmadığından emin olduktan sonra kaldır.');
      throw e;
    }
  }
  const db = new PGlite(dataDir);
  try{await db.transaction(async tx=>migrate({query:async(sql,values=[]) => (await tx.query<any>(sql,values)).rows},sql=>tx.exec(sql)));}
  catch(error){await db.close().catch(()=>{});if(lockFile)await unlink(lockFile);throw error;}
  let tail = Promise.resolve();
  async function serial<T>(f:()=>Promise<T>) {
    const previous = tail; let release!:()=>void;
    tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { return await f(); } finally { release(); }
  }
  return {
    query: (sql, values=[]) => serial(async () => (await db.query<any>(sql,values)).rows),
    tx: work => serial(() => db.transaction(tx => work({query: async (sql, values=[]) => (await tx.query<any>(sql,values)).rows}))),
    close: () => serial(async()=>{await db.close();if(lockFile)await unlink(lockFile);}),
  };
}
