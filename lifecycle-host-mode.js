(() => {
 const sync=()=>{const active=document.querySelector('.tabs button.active')?.dataset.view;document.body.classList.toggle('lifecycle-host-mode',active==='lifecycle')};
 const refresh=()=>requestAnimationFrame(()=>{try{window.渲染全部?.()}catch(error){console.warn('主视图刷新失败',error)}try{document.getElementById('productLifecycleFrame')?.contentWindow?.renderAll?.()}catch(error){console.warn('生命周期视图刷新失败',error)}});
 document.querySelectorAll('.tabs button').forEach(b=>b.addEventListener('click',()=>setTimeout(sync,0)));
 sync();
 window.addEventListener('message',e=>{if(e.data?.type==='plm:product-image-updated')window.dispatchEvent(new CustomEvent('product-image:updated',{detail:e.data}))});
 window.addEventListener('product-lifecycle:data-committed',refresh);
 window.addEventListener('product-lifecycle:product-updated',refresh);
})();