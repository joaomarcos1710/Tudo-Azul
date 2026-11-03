import { supabase } from './supabase'
import { centsFromDb, centsToDecimal } from './format'
import type { Cents } from './format'
export type MoedaBem='BRL'|'USD'|'EUR'
export type TipoBem='real_estate'|'vehicle'|'collectible'|'other'
export interface Bem {id:string;nome:string;tipo:TipoBem;descricao:string|null;moeda:MoedaBem;titularidade:string;participacao:number;status:'active'|'sold'|'disposed';encerradoEm:string|null;valor:Cents|null;data:string|null;fonte:string|null;quantidadeAvaliacoes:number}
function db(){if(!supabase)throw new Error('Supabase não configurado');return supabase}
export async function listarBens(h:string):Promise<Bem[]>{
 const {data,error}=await db().from('family_assets').select('id,name,asset_type,description,currency_code,ownership_label,household_share,status,ended_on').eq('household_id',h).order('name');if(error)throw error;
 const rows=data??[];if(!rows.length)return [];
 const {data:vs,error:e}=await db().from('family_asset_valuations').select('asset_id,valuation_date,total_value,source').eq('household_id',h).in('asset_id',rows.map(x=>x.id)).order('valuation_date',{ascending:false}).order('created_at',{ascending:false});if(e)throw e;
 const latest=new Map<string,any>();const counts=new Map<string,number>();for(const v of vs??[]){counts.set(v.asset_id,(counts.get(v.asset_id)??0)+1);if(!latest.has(v.asset_id))latest.set(v.asset_id,v)}
 return rows.map(r=>{const v=latest.get(r.id);return{id:r.id,nome:r.name,tipo:r.asset_type as TipoBem,descricao:r.description,moeda:r.currency_code as MoedaBem,titularidade:r.ownership_label,participacao:Number(r.household_share),status:r.status as Bem['status'],encerradoEm:r.ended_on,valor:v?centsFromDb(v.total_value):null,data:v?.valuation_date??null,fonte:v?.source??null,quantidadeAvaliacoes:counts.get(r.id)??0}})
}
export async function criarBem(d:{familia:string;nome:string;tipo:TipoBem;descricao:string;moeda:MoedaBem;titularidade:string;participacao:number;adquirido:string;valor:Cents;data:string;fonte:string}){const {error}=await db().rpc('family_asset_create',{p_household:d.familia,p_name:d.nome,p_type:d.tipo,p_description:d.descricao||null,p_currency:d.moeda,p_owner:d.titularidade,p_share:d.participacao,p_acquired:d.adquirido||null,p_initial_value:centsToDecimal(d.valor),p_valuation_date:d.data,p_source:d.fonte});if(error)throw error}
export async function avaliarBem(id:string,data:string,valor:Cents,fonte:string){const {error}=await db().rpc('family_asset_valuation_record',{p_asset:id,p_date:data,p_value:centsToDecimal(valor),p_source:fonte,p_notes:null});if(error)throw error}
export async function encerrarBem(id:string,status:'sold'|'disposed',data:string){const {error}=await db().rpc('family_asset_end',{p_asset:id,p_status:status,p_date:data});if(error)throw error}

export async function excluirBem(id:string){const {error}=await db().rpc('family_asset_delete',{p_asset:id});if(error)throw error}
