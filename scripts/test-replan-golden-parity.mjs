import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';

function decodeFixture(){
  const wrapper=JSON.parse(fs.readFileSync(new URL('../data/migrations/accepted-baseline-20260817.json',import.meta.url),'utf8'));
  for(const [key,value] of Object.entries(wrapper)){
    if(typeof value!=='string'||value.length<100)continue;
    try{
      const raw=Buffer.from(value,'base64');
      for(const decoder of [buf=>zlib.gunzipSync(buf),buf=>zlib.inflateSync(buf),buf=>buf]){
        try{
          const parsed=JSON.parse(decoder(raw).toString('utf8'));
          console.log(`golden fixture decoded from field: ${key}`);
          return parsed;
        }catch(_){/* try next */}
      }
    }catch(_){/* not base64 payload */}
  }
  return wrapper;
}

function describe(value,depth=0){
  if(depth>2)return typeof value;
  if(Array.isArray(value)){
    const first=value[0];
    return {type:'array',length:value.length,first:first&&typeof first==='object'?Object.keys(first).slice(0,30):typeof first};
  }
  if(value&&typeof value==='object'){
    const out={};
    for(const [k,v] of Object.entries(value).slice(0,30))out[k]=describe(v,depth+1);
    return out;
  }
  return typeof value;
}

const golden=decodeFixture();
const live=JSON.parse(fs.readFileSync(new URL('../data/app-data.json',import.meta.url),'utf8'));
console.log('GOLDEN_SCHEMA',JSON.stringify(describe(golden),null,2));
console.log('LIVE_STORES_SAMPLE',(live.stores||[]).slice(0,40).map(x=>`${x.store}|${x.type||''}`).join('\n'));
console.log('LIVE_SKU_STORE_COUNTS',JSON.stringify(Object.entries((live.skus||[]).reduce((m,r)=>(m[r.store]=(m[r.store]||0)+(r.included!==false?1:0),m),{})).sort((a,b)=>a[0].localeCompare(b[0],'zh-CN')),null,2));

// RED phase: this diagnostic is intentionally failing until the accepted workbook schema
// is mapped into exact per-store parity assertions.
assert.fail('GOLDEN_PARITY_DIAGNOSTIC_RED');
