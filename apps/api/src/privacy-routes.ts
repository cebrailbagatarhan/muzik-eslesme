import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Context } from './context.js';

const optionalKinds=['product-analytics','research-contact'] as const;
export async function privacyRoutes(app:FastifyInstance,ctx:Context) {
  app.get('/v1/consents',async req=>{
    const rows=await ctx.db.query('SELECT kind,version,granted_at,revoked_at FROM consents WHERE user_id=$1 ORDER BY granted_at DESC',[req.actor.id]);
    const active=new Map(rows.filter(r=>!r.revoked_at).map(r=>[r.kind,r]));
    return {
      required:{termsAndPrivacy:active.get('terms-and-privacy')??null},
      optional:optionalKinds.map(kind=>({kind,granted:active.has(kind),version:active.get(kind)?.version??null}))
    };
  });
  app.put('/v1/consents/:kind',async req=>{
    const {kind}=z.object({kind:z.enum(optionalKinds)}).parse(req.params),{granted,version}=z.object({granted:z.boolean(),version:z.string().trim().min(1).max(64)}).parse(req.body);
    return ctx.write(req,'consent.updated',async q=>{
      await q.query('UPDATE consents SET revoked_at=now() WHERE user_id=$1 AND kind=$2 AND revoked_at IS NULL',[req.actor.id,kind]);
      if(granted)await q.query('INSERT INTO consents(id,user_id,kind,version) VALUES($1,$2,$3,$4)',[randomUUID(),req.actor.id,kind,version]);
      return {kind,granted};
    });
  });
}
