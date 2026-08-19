(function installProductPoolReplanUI(){
  const esc=value=>String(value??"").replace(/[&<>"']/g,character=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[character]));
  const q=selector=>document.querySelector(selector);
  const qa=selector=>Array.from(document.querySelectorAll(selector));
  let service=null;
  let bound=false;

  function app(){return window.FrozenCartonApp;}
  function state(){return app()?.getState?.()||null;}
  function activePool(st){return service?.activeProductPool(st?.productPool||[])||[]}
  function selectedStores(){return qa("#replanScopeV2 input[type=checkbox]:checked").map(input=>input.value)}
  function selectedProduct(st){const key=q("#poolActionSku")?.value||"";return (st?.productPool||[]).find(item=>String(item.barcode||item.id||item.name)===key)||null}

  function renderPoolTable(){
    const st=state();const root=q("#poolTableV2");if(!st||!root)return;
    const keyword=(q("#poolSearchV2")?.value||"").trim().toLowerCase();
    const rows=(st.productPool||[]).filter(item=>!keyword||Object.values(item).some(value=>String(value??"").toLowerCase().includes(keyword)));
    root.innerHTML=`<table><thead><tr><th>状态</th><th>商品</th><th>条码</th><th>等级</th><th>排名</th><th>三级类目</th><th>四级品类</th><th>尺寸</th><th>箱规</th><th>日销</th></tr></thead><tbody>${rows.map(item=>`<tr><td>${item.active===false?"已淘汰":"在售"}</td><td>${esc(item.name)}</td><td>${esc(item.barcode)}</td><td>${esc(item.grade)}</td><td>${esc(item.rank)}</td><td>${esc(item.category3)}</td><td>${esc(item.category4)}</td><td>${esc(`${item.length||0}×${item.width||0}×${item.height||0}`)}</td><td>${esc(item.carton)}</td><td>${esc(item.dailyQty)}</td></tr>`).join("")||`<tr><td colspan="10">暂无产品池数据</td></tr>`}</tbody></table>`;
  }

  function renderSelector(){
    const st=state();const select=q("#poolActionSku");if(!st||!select)return;
    const current=select.value;
    select.innerHTML=`<option value="">选择已有SKU</option>${(st.productPool||[]).map(item=>`<option value="${esc(item.barcode||item.id||item.name)}">${esc(item.name)} · ${esc(item.barcode)}${item.active===false?" · 已淘汰":""}</option>`).join("")}`;
    select.value=current;
  }

  function fillProductForm(){
    const item=selectedProduct(state());if(!item)return;
    const map={poolNameV2:"name",poolBarcodeV2:"barcode",poolGradeV2:"grade",poolRankV2:"rank",poolCategory3V2:"category3",poolCategory4V2:"category4",poolLengthV2:"length",poolWidthV2:"width",poolHeightV2:"height",poolCartonV2:"carton",poolDailyQtyV2:"dailyQty"};
    Object.entries(map).forEach(([id,key])=>{const el=q(`#${id}`);if(el)el.value=item[key]??""});
  }

  function stage(operation){
    const st=state();if(!st)return;
    st.productPoolStaging=[...(st.productPoolStaging||[]),operation];
    app().saveDraftState(st);
  }

  function renderStaging(){
    const st=state();const root=q("#poolStagingV2");if(!root)return;
    const list=st?.productPoolStaging||[];
    root.innerHTML=list.length?list.map((item,index)=>`<div class="pool-staging-item"><span>${esc(item.type)} · ${esc(item.product?.name||item.name||item.product?.barcode||item.barcode||item.productKey||"")}</span><button type="button" data-remove-stage="${index}">移除</button></div>`).join(""):"<div class=\"empty\">暂无待发布变更。</div>";
    qa("[data-remove-stage]").forEach(button=>button.onclick=()=>{const next=state();next.productPoolStaging=(next.productPoolStaging||[]).filter((_,index)=>index!==Number(button.dataset.removeStage));app().saveDraftState(next)});
  }

  function renderReplanScope(){
    const st=state();const root=q("#replanScopeV2");if(!st||!root)return;
    const old=new Set(selectedStores());
    root.innerHTML=(st.stores||[]).map(store=>{const name=String(store.store||"");return `<label><input type="checkbox" value="${esc(name)}" ${old.size?old.has(name)?"checked":"":"checked"}>${esc(name)}</label>`}).join("");
  }

  function renderResults(){
    const st=state();const root=q("#replanResultsV2");const badge=q("#replanDraftBadge");if(!root||!st)return;
    const draft=st.frozen_carton_replan_draft_v2;
    if(!draft){root.innerHTML="<div class=\"empty\">尚未生成产品池重排草稿。</div>";if(badge)badge.textContent="无重排草稿";return}
    if(badge)badge.textContent=`草稿 ${draft.summary?.storeCount||0}店 · 通过${draft.summary?.passed||0} · 复核${draft.summary?.reviewRequired||0} · 失败${draft.summary?.failed||0}`;
    const applied=new Set(draft.appliedStores||[]);
    root.innerHTML=`<table><thead><tr><th>应用</th><th>门店</th><th>状态</th><th>候选SKU</th><th>纳入</th><th>本店未纳入</th><th>直接整箱</th><th>外储SKU</th><th>建议外储</th><th>验证</th></tr></thead><tbody>${(draft.results||[]).map(result=>{const metrics=result.metrics||{};const klass=result.status==="passed"?"replan-ok":result.status==="review_required"?"replan-review":"replan-fail";return `<tr><td><input type="checkbox" data-replan-store="${esc(result.store)}" ${applied.has(result.store)?"":"checked"}></td><td>${esc(result.store)}</td><td class="${klass}">${esc(result.status)}</td><td>${esc(metrics.candidateSkuCount)}</td><td>${esc(metrics.includedSkuCount)}</td><td>${esc(metrics.excludedForStoreCount)}</td><td>${esc(metrics.directCartonSkuCount)}</td><td>${esc(metrics.externalSkuCount)}</td><td>${esc(metrics.suggestedExternalL)}L</td><td>${result.validation?.ok?"通过":"失败"}</td></tr>`}).join("")}</tbody></table>`;
  }

  async function generate(){
    const st=state();if(!st||!service)return;
    const scope=selectedStores();if(!scope.length){alert("请至少选择一家门店");return}
    const progress=q("#replanProgressV2");if(progress)progress.textContent=`正在生成${scope.length}家门店重排草稿…`;
    const previousPlans=Object.fromEntries(scope.map(store=>[store,service.previousPlanFromStoreState(st,store)]));
    const request={productPool:st.productPool||[],stores:st.stores||[],cabinets:st.cabinets||[],params:st.params||{},scope,physicalRecords:st.physicalRecords||[],previousPlans,optimization:{maxIterations:12,maxExpansions:180},generatedAt:""};
    try{
      let draft;
      if(typeof Worker!=="undefined"){
        draft=await new Promise((resolve,reject)=>{const worker=new Worker("scripts/replan-worker.mjs",{type:"module"});const timer=setTimeout(()=>{worker.terminate();reject(new Error("重排Worker超时"))},Math.max(30000,scope.length*30000));worker.onmessage=event=>{clearTimeout(timer);worker.terminate();if(event.data?.ok)resolve(event.data.draft);else reject(new Error(event.data?.error||"重排失败"))};worker.onerror=event=>{clearTimeout(timer);worker.terminate();reject(event.error||new Error(event.message||"重排Worker错误"))};worker.postMessage(request)})
      }else draft=service.generateReplanDraft(request);
      const next=state();next.frozen_carton_replan_draft_v2=draft;app().saveDraftState(next);if(progress)progress.textContent=`重排草稿已保存：${draft.summary.storeCount}家门店`;
    }catch(error){if(progress)progress.textContent=`重排失败：${error.message||error}`;console.error(error)}
  }

  function applyDraft(mode="selected"){
    const st=state();const draft=st?.frozen_carton_replan_draft_v2;if(!draft||!service){alert("请先生成重排草稿");return}
    const currentPlanSignatures=Object.fromEntries((draft.scope||[]).map(store=>[store,service.planSignature(service.previousPlanFromStoreState(st,store))]));
    const check=service.isReplanDraftStale(draft,{productPool:st.productPool||[],cabinets:st.cabinets||[],currentPlanSignatures});
    if(check.stale){alert(`重排草稿已过期：${check.reasons.join("；")}`);return}
    const selected=mode==="passed"
      ? (draft.results||[]).filter(result=>result.status==="passed").map(result=>result.store)
      : qa("[data-replan-store]:checked").map(input=>input.dataset.replanStore);
    if(!selected.length){alert(mode==="passed"?"当前没有已通过门店可应用":"请至少勾选一家门店");return}
    const next=service.applyReplanDraftToOperationalState(st,draft,st.stores||[],selected);app().saveDraftState(next);
    const progress=q("#replanProgressV2");if(progress)progress.textContent="已将选定重排结果应用到运营草稿；正式发布状态未改变。";
  }

  function publishPool(){
    const st=state();const operations=st?.productPoolStaging||[];if(!operations.length){alert("暂无待发布产品池变更");return}
    const result=service.publishProductPoolChanges(st,operations,{effectiveAt:""});if(!result.ok){alert(result.errors.join("\n"));return}
    result.state.productPoolStaging=[];app().saveDraftState(result.state);
  }

  function installNewStoreBenchmark(){
    const input=q("#newStoreExternalCap");if(!input||q("#newStoreBenchmark"))return;
    const label=document.createElement("label");label.innerHTML="对标门店（用于P95）<select id=\"newStoreBenchmark\"><option value=\"\">请选择真实对标门店</option></select>";input.parentElement?.parentElement?.insertBefore(label,input.parentElement.nextSibling);
    const refresh=()=>{const select=q("#newStoreBenchmark");const st=state();if(!select||!st)return;const old=select.value;select.innerHTML='<option value="">请选择真实对标门店</option>'+(st.stores||[]).filter(item=>Number(item.p95Factor)>0).sort((a,b)=>String(a.store).localeCompare(String(b.store),"zh-CN")).map(item=>`<option value="${esc(item.store)}">${esc(item.store)} · P95 ${esc(item.p95Factor)}</option>`).join("");if((st.stores||[]).some(item=>item.store===old))select.value=old};
    refresh();
    if(!window.__newStoreBenchmarkWrapped){
      const original=window.测算新增门店;
      if(typeof original==="function"){
        window.测算新增门店=()=>{const store=q("#newStoreName")?.value.trim();const selected=q("#newStoreBenchmark")?.value;const benchmark=(state()?.stores||[]).find(item=>item.store===selected);if(!store){alert("请填写门店名称");return}if(!benchmark){alert("请先选择真实对标门店，系统不会猜测P95系数");return}window.__newStoreP95Override={store,p95Factor:Number(benchmark.p95Factor),p95Source:`benchmark-store:${benchmark.store}`};original()};
        window.__newStoreBenchmarkWrapped=true;
      }
    }
  }

  function addBindings(){
    if(bound)return;bound=true;
    q("#poolActionSku")?.addEventListener("change",fillProductForm);
    q("#poolSearchV2")?.addEventListener("input",renderPoolTable);
    q("#poolStageAddBtn")?.addEventListener("click",()=>{const product={id:"",name:q("#poolNameV2")?.value.trim(),barcode:q("#poolBarcodeV2")?.value.trim(),grade:q("#poolGradeV2")?.value.trim(),rank:Number(q("#poolRankV2")?.value||9999),category3:q("#poolCategory3V2")?.value.trim(),category4:q("#poolCategory4V2")?.value.trim(),length:Number(q("#poolLengthV2")?.value||0),width:Number(q("#poolWidthV2")?.value||0),height:Number(q("#poolHeightV2")?.value||0),carton:Number(q("#poolCartonV2")?.value||1),dailyQty:Number(q("#poolDailyQtyV2")?.value||0)};stage({type:"add",product})});
    q("#poolStageUpdateBtn")?.addEventListener("click",()=>{const item=selectedProduct(state());if(!item){alert("请先选择SKU");return}const changes={};const map={poolNameV2:"name",poolBarcodeV2:"barcode",poolGradeV2:"grade",poolRankV2:"rank",poolCategory3V2:"category3",poolCategory4V2:"category4",poolLengthV2:"length",poolWidthV2:"width",poolHeightV2:"height",poolCartonV2:"carton",poolDailyQtyV2:"dailyQty"};Object.entries(map).forEach(([id,key])=>{const value=q(`#${id}`)?.value;if(value!==undefined&&value!=="")changes[key]=["rank","length","width","height","carton","dailyQty"].includes(key)?Number(value):value});stage({type:"update",barcode:item.barcode,name:item.name,changes})});
    q("#poolStageRetireBtn")?.addEventListener("click",()=>{const item=selectedProduct(state());if(item)stage({type:"retire",barcode:item.barcode,name:item.name})});
    q("#poolStageRestoreBtn")?.addEventListener("click",()=>{const item=selectedProduct(state());if(item)stage({type:"restore",barcode:item.barcode,name:item.name})});
    q("#poolPublishBtn")?.addEventListener("click",publishPool);
    q("#replanAllBtn")?.addEventListener("click",()=>qa("#replanScopeV2 input[type=checkbox]").forEach(input=>input.checked=true));
    q("#replanGenerateBtn")?.addEventListener("click",generate);
    q("#replanApplyBtn")?.addEventListener("click",()=>applyDraft("selected"));
    q("#replanApplyPassedBtn")?.addEventListener("click",()=>applyDraft("passed"));
  }

  window.ProductPoolReplanUI={
    init:async()=>{service=await import("./scripts/product-pool-replan-service.mjs");addBindings();installNewStoreBenchmark();render()},
    render:()=>{if(!service)return;renderSelector();renderPoolTable();renderStaging();renderReplanScope();renderResults();installNewStoreBenchmark();const badge=q("#poolRevisionBadge");const current=state();if(badge)badge.textContent=`当前版本 ${service.productPoolRevision(current?.productPool||[])}`}
  };
})();
