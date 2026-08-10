(() => {
 const sync=()=>{const active=document.querySelector('.tabs button.active')?.dataset.view;document.body.classList.toggle('lifecycle-host-mode',active==='lifecycle')};
 const refresh=()=>requestAnimationFrame(()=>{try{window.娓叉煋鍏ㄩ儴?.()}catch(error){console.warn('涓昏鍥惧埛鏂板け璐?,error)}try{document.getElementById('productLifecycleFrame')?.contentWindow?.renderAll?.()}catch(error){console.warn('鐢熷懡鍛ㄦ湡瑙嗗浘鍒锋柊澶辫触',error)}});
 document.querySelectorAll('.tabs button').forEach(b=>b.addEventListener('click',()=>setTimeout(sync,0)));
 sync();
 window.addEventListener('message',e=>{if(e.data?.type==='plm:product-image-updated')window.dispatchEvent(new CustomEvent('product-image:updated',{detail:e.data}))});
 window.addEventListener('product-lifecycle:data-committed',refresh);
 window.addEventListener('product-lifecycle:product-updated',refresh);
})();
