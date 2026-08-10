/* Stable planogram fixes v20260730-final: no MutationObserver, no endless polling, editable Excel export. */
(function () {
  'use strict';

  const EXCELJS_PRIMARY = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
  const EXCELJS_FALLBACK = 'https://unpkg.com/exceljs@4.4.0/dist/exceljs.min.js';
  const BASE_WIDTH_MM = 50;
  let poolQuery = '';
  let excelJsPromise = null;

  function text(node) {
    return (node && node.textContent || '').trim();
  }

  function number(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function format(value, digits) {
    const n = number(value);
    return n.toFixed(digits == null ? 0 : digits).replace(/\.0+$/, '');
  }

  function appState() {
    try {
      if (typeof 鐘舵€?!== 'undefined' && 鐘舵€? return 鐘舵€?
    } catch (_) {}
    return window.UNIFIED_CARTON_DATA || {};
  }

  function appCurrent() {
    try {
      if (typeof 褰撳墠 !== 'undefined' && 褰撳墠) return 褰撳墠;
    } catch (_) {}
    return {};
  }

  function currentStore() {
    try {
      if (typeof 闂ㄥ簵鍚?=== 'function') return 闂ㄥ簵鍚?);
    } catch (_) {}
    return document.getElementById('storeSelect')?.value || '';
  }

  function includedRows(store) {
    try {
      if (typeof 绾冲叆SKU === 'function') return 绾冲叆SKU(store);
    } catch (_) {}
    return (appState().skus || []).filter(function (row) {
      return row.store === store && row.included !== false;
    });
  }

  function rowCalc(row) {
    try {
      if (typeof 璁＄畻SKU === 'function') return 璁＄畻SKU(row);
    } catch (_) {}
    const full = Math.max(0, Math.round(number(row.displayCols) * number(row.perCol)));
    const triggerRate = number(appState().params?.triggerRate || 0.1);
    const trigger = Math.ceil(full * triggerRate);
    const receivable = Math.max(0, full - trigger);
    const carton = Math.max(1, number(row.carton || 1));
    const inShelf = Math.min(carton, receivable);
    const external = Math.max(0, carton - inShelf);
    const vol = number(row.volume) || number(row.length) * number(row.width) * number(row.height) / 1000000;
    const staticVol = external * vol;
    const externalDays = number(row.dailyQty) > 0 ? external / number(row.dailyQty) : 0;
    const risk = external <= 0 ? '鏃犲鍌? : externalDays <= 15 ? '浣庨闄? : externalDays <= 45 ? '涓闄? : externalDays <= 90 ? '楂橀闄? : '鏋侀珮椋庨櫓';
    return { full, trigger, receivable, inShelf, external, vol, staticVol, risk };
  }

  function rowWidth(row) {
    try {
      if (typeof SKU鍗犵敤瀹藉害 === 'function') return SKU鍗犵敤瀹藉害(row);
    } catch (_) {}
    return Math.max(0, number(row.displayCols) * number(row.faceWidth));
  }

  function cabinetUsage() {
    try {
      if (typeof 鏌滄浣跨敤 === 'function') return 鏌滄浣跨敤();
    } catch (_) {}
    const state = appState();
    const map = new Map((state.cabinets || []).map(function (cabinet) {
      return [cabinet.key, Object.assign({}, cabinet, { used: 0, left: number(cabinet.length), items: [] })];
    }));
    (state.skus || []).forEach(function (row) {
      if (row.included === false || !row.cabinetKey) return;
      const cabinet = map.get(row.cabinetKey);
      if (!cabinet) return;
      const used = rowWidth(row);
      cabinet.used += used;
      cabinet.items.push(row);
      cabinet.left = number(cabinet.length) - cabinet.used;
    });
    return Array.from(map.values());
  }

  function cabinetLabel(row) {
    try {
      if (typeof 鏌滃悕 === 'function') return 鏌滃悕(row);
    } catch (_) {}
    return row.cabinetLabel || '';
  }

  function cabinetPosition(row) {
    try {
      if (typeof 鏌滀綅 === 'function') return 鏌滀綅(row);
    } catch (_) {}
    return row.position || '';
  }

  function cabinetType(cabinet) {
    try {
      if (typeof 鍐版煖绫诲瀷 === 'function') return 鍐版煖绫诲瀷(cabinet);
    } catch (_) {}
    const value = [cabinet?.kind, cabinet?.label].filter(Boolean).join(' ');
    if (/鍐版穱娣媩闆硶|鍐板搧/.test(value)) return '鍐版穱娣嬫煖';
    if (/绔嬫煖/.test(value)) return '绔嬫煖';
    if (/鍗ф煖/.test(value)) return '鍗ф煖';
    return cabinet?.kind || '鍏朵粬';
  }

  function cabinetNumber(cabinet) {
    try {
      if (typeof 鏌滃彿 === 'function') return 鏌滃彿(cabinet);
    } catch (_) {}
    return cabinet?.label || '';
  }

  function selectedSku(card) {
    const meta = text(card.querySelector('.selection-meta'));
    const barcode = (meta.split(/[锝渱]/)[0] || '').trim();
    const name = text(card.querySelector('.selection-head strong'));
    const rows = appState().skus || [];
    return rows.find(function (row) { return String(row.barcode || '') === barcode; }) ||
      rows.find(function (row) { return row.name === name; }) || null;
  }

  function enhanceSelectedCard() {
    const card = document.querySelector('#displayMapMonitor .selection-card-active');
    if (!card) return;
    const sku = selectedSku(card);
    if (!sku) return;
    const key = [sku.id, sku.carton, sku.faceWidth].join('|');
    const existing = card.querySelector('.selection-basic-info');
    if (existing && existing.dataset.previewKey === key) return;
    if (existing) existing.remove();
    const info = document.createElement('div');
    info.className = 'selection-basic-info';
    info.dataset.previewKey = key;
    info.innerHTML = '<div><span>绠辫</span><strong>' + (number(sku.carton) || 0) + ' 浠?绠?/strong></div>' +
      '<div><span>鍗曞垪鍗犲</span><strong>' + (number(sku.faceWidth) || 0) + ' mm</strong></div>';
    const actions = card.querySelector('.selection-actions');
    if (actions) actions.insertAdjacentElement('afterend', info);
    else card.appendChild(info);
  }

  function findSkuElement(id) {
    return document.querySelector('#displaymap .map-item[data-sku-id="' + CSS.escape(id) + '"]');
  }

  function safeLocate(id) {
    const item = findSkuElement(id);
    if (!item) return false;
    document.querySelectorAll('#displayMapCanvas .map-item.map-locate').forEach(function (node) {
      node.classList.remove('map-locate');
    });
    item.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'nearest' });
    item.classList.remove('map-locate');
    void item.offsetWidth;
    item.classList.add('map-locate');
    setTimeout(function () { item.classList.remove('map-locate'); }, 2200);
    return true;
  }

  function installLocateOverride() {
    try {
      if (typeof 瀹氫綅鍒伴檲鍒楀浘鍟嗗搧 === 'function') {
        瀹氫綅鍒伴檲鍒楀浘鍟嗗搧 = safeLocate;
        window.瀹氫綅鍒伴檲鍒楀浘鍟嗗搧 = safeLocate;
        return true;
      }
    } catch (_) {}
    return false;
  }

  function applyPoolFilter() {
    const monitor = document.getElementById('displayMapMonitor');
    if (!monitor) return;
    const input = monitor.querySelector('#displayMapPoolSearch');
    if (input && input.value !== poolQuery) input.value = poolQuery;
    const query = poolQuery.trim().toLowerCase();
    const list = monitor.querySelector('.pool-list');
    if (!list) return;
    let visible = 0;
    list.querySelectorAll('.pool-item').forEach(function (item) {
      const matched = !query || item.textContent.toLowerCase().includes(query);
      item.hidden = !matched;
      if (matched) visible += 1;
    });
    let empty = list.querySelector('.pool-filter-empty');
    if (!visible && query) {
      if (!empty) {
        empty = document.createElement('div');
        empty.className = 'empty pool-filter-empty';
        empty.textContent = '娌℃湁鍖归厤鐨勫晢鍝?;
        list.appendChild(empty);
      }
      empty.hidden = false;
    } else if (empty) {
      empty.hidden = true;
    }
  }

  function installPoolSearchFix() {
    document.addEventListener('input', function (event) {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.id !== 'displayMapPoolSearch') return;
      poolQuery = input.value;
      event.stopImmediatePropagation();
      applyPoolFilter();
    }, true);

    document.getElementById('storeSelect')?.addEventListener('change', function () {
      poolQuery = '';
    });
  }

  function syncCategoryPicker() {
    const select = document.getElementById('displayMapCategoryFilter');
    if (!select) return;
    let picker = document.getElementById('planogramCategoryPicker');
    if (!picker) {
      picker = document.createElement('div');
      picker.id = 'planogramCategoryPicker';
      picker.className = 'planogram-category-picker';
      picker.innerHTML = '<button type="button" class="category-picker-toggle" aria-expanded="false"></button>' +
        '<div class="category-picker-menu" hidden>' +
        '<input type="search" class="category-picker-search" placeholder="鎼滅储鍥涚骇鍝佺被">' +
        '<div class="category-picker-options"></div></div>';
      select.insertAdjacentElement('afterend', picker);

      const toggle = picker.querySelector('.category-picker-toggle');
      const menu = picker.querySelector('.category-picker-menu');
      const search = picker.querySelector('.category-picker-search');
      toggle.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        const open = menu.hidden;
        menu.hidden = !open;
        toggle.setAttribute('aria-expanded', String(open));
        if (open) {
          search.value = '';
          picker.querySelectorAll('.category-picker-option').forEach(function (button) { button.hidden = false; });
          requestAnimationFrame(function () { search.focus(); });
        }
      });
      search.addEventListener('input', function () {
        const query = search.value.trim().toLowerCase();
        picker.querySelectorAll('.category-picker-option').forEach(function (button) {
          button.hidden = !!query && !button.textContent.toLowerCase().includes(query);
        });
      });
      document.addEventListener('click', function (event) {
        if (!picker.contains(event.target)) {
          menu.hidden = true;
          toggle.setAttribute('aria-expanded', 'false');
        }
      });
    }

    select.classList.add('category-filter-native-hidden');
    const toggle = picker.querySelector('.category-picker-toggle');
    const options = picker.querySelector('.category-picker-options');
    const selected = select.options[select.selectedIndex];
    toggle.textContent = selected ? selected.textContent : '鍏ㄩ儴鍥涚骇鍝佺被';
    const optionSignature = Array.from(select.options).map(function (option) {
      return option.value + '::' + option.textContent;
    }).join('||') + '##' + select.value;
    if (picker.dataset.optionSignature === optionSignature) return;
    picker.dataset.optionSignature = optionSignature;
    options.innerHTML = '';
    Array.from(select.options).forEach(function (option) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'category-picker-option' + (option.value === select.value ? ' active' : '');
      button.textContent = option.textContent;
      button.dataset.value = option.value;
      button.addEventListener('click', function () {
        select.value = button.dataset.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        picker.querySelector('.category-picker-menu').hidden = true;
        picker.querySelector('.category-picker-toggle').setAttribute('aria-expanded', 'false');
      });
      options.appendChild(button);
    });
  }

  function trimPlanogramSpace() {
    const active = document.getElementById('displaymap')?.classList.contains('active');
    document.body.classList.toggle('planogram-active', !!active);
    const host = document.getElementById('displayStagingHost');
    if (host && !host.textContent.trim() && !host.children.length) host.hidden = true;
    else if (host) host.hidden = false;
  }

  let hooksInstalled = false;

  function installDirectHooks() {
    if (hooksInstalled) return true;
    let ready = false;
    try {
      ready = typeof 娓叉煋闄堝垪鍥?=== 'function' &&
        typeof 娓叉煋闄堝垪鍥惧彸渚?=== 'function' &&
        typeof 瀹氫綅鍒伴檲鍒楀浘鍟嗗搧 === 'function';
    } catch (_) {}
    if (!ready) return false;

    const originalRenderSide = 娓叉煋闄堝垪鍥惧彸渚?
    const wrappedRenderSide = function () {
      const oldInput = document.getElementById('displayMapPoolSearch');
      if (oldInput) oldInput.value = '';
      const result = originalRenderSide.apply(this, arguments);
      enhanceSelectedCard();
      syncCategoryPicker();
      applyPoolFilter();
      trimPlanogramSpace();
      return result;
    };
    wrappedRenderSide.__stablePlanogramFix = true;
    娓叉煋闄堝垪鍥惧彸渚?= wrappedRenderSide;
    window.娓叉煋闄堝垪鍥惧彸渚?= wrappedRenderSide;

    const originalRenderMap = 娓叉煋闄堝垪鍥?
    const wrappedRenderMap = function () {
      const result = originalRenderMap.apply(this, arguments);
      syncCategoryPicker();
      applyPoolFilter();
      trimPlanogramSpace();
      return result;
    };
    wrappedRenderMap.__stablePlanogramFix = true;
    娓叉煋闄堝垪鍥?= wrappedRenderMap;
    window.娓叉煋闄堝垪鍥?= wrappedRenderMap;

    瀹氫綅鍒伴檲鍒楀浘鍟嗗搧 = safeLocate;
    window.瀹氫綅鍒伴檲鍒楀浘鍟嗗搧 = safeLocate;

    try {
      if (typeof 瀵煎嚭闄堝垪鍥?=== 'function') {
        瀵煎嚭闄堝垪鍥?= exportExcelPlanogram;
        window.瀵煎嚭闄堝垪鍥?= exportExcelPlanogram;
      }
    } catch (_) {}

    document.querySelectorAll('.tabs button').forEach(function (button) {
      if (button.dataset.stablePlanogramTabBound === 'true') return;
      button.dataset.stablePlanogramTabBound = 'true';
      button.addEventListener('click', function () {
        requestAnimationFrame(function () {
          trimPlanogramSpace();
          if (button.dataset.view === 'displaymap') {
            syncCategoryPicker();
            applyPoolFilter();
          }
        });
      });
    });

    hooksInstalled = true;
    bindExportButton();
    syncCategoryPicker();
    applyPoolFilter();
    trimPlanogramSpace();
    return true;
  }

  function loadScript(url) {
    return new Promise(function (resolve, reject) {
      const existing = Array.from(document.scripts).find(function (script) { return script.src === url; });
      if (existing) {
        if (window.ExcelJS) resolve(window.ExcelJS);
        else {
          existing.addEventListener('load', function () { resolve(window.ExcelJS); }, { once: true });
          existing.addEventListener('error', reject, { once: true });
        }
        return;
      }
      const script = document.createElement('script');
      script.src = url;
      script.async = true;
      script.onload = function () {
        if (window.ExcelJS) resolve(window.ExcelJS);
        else reject(new Error('ExcelJS鏈纭姞杞?));
      };
      script.onerror = function () { reject(new Error('ExcelJS鍔犺浇澶辫触')); };
      document.head.appendChild(script);
    });
  }

  function ensureExcelJS() {
    if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
    if (excelJsPromise) return excelJsPromise;
    excelJsPromise = loadScript(EXCELJS_PRIMARY).catch(function () {
      return loadScript(EXCELJS_FALLBACK);
    }).then(function () {
      if (!window.ExcelJS) throw new Error('Excel缁勪欢鍔犺浇澶辫触');
      return window.ExcelJS;
    }).catch(function (error) {
      excelJsPromise = null;
      throw error;
    });
    return excelJsPromise;
  }

  const thinBorder = {
    top: { style: 'thin', color: { argb: 'FFD7E0DC' } },
    left: { style: 'thin', color: { argb: 'FFD7E0DC' } },
    bottom: { style: 'thin', color: { argb: 'FFD7E0DC' } },
    right: { style: 'thin', color: { argb: 'FFD7E0DC' } }
  };

  const fills = {
    normal: 'FFE8F5EF',
    external: 'FFF0F2F1',
    changed: 'FFFFF3CD',
    launch: 'FFE8F0FF',
    retire: 'FFFFEAD5',
    restore: 'FFF1E9FF',
    free: 'FFFAFBFA',
    other: 'FFE9ECEB',
    storage: 'FFE5E7EB',
    danger: 'FFFFE2E0',
    title: 'FF1F5E46',
    section: 'FFEFF5F2',
    header: 'FFE7ECE9'
  };

  function fillForRow(row, calc) {
    const status = [row.lifecycleStatus, row.status, row.changeNote].filter(Boolean).join(' ');
    if (/寰呬笂鏂皘涓婃柊/.test(status)) return fills.launch;
    if (/寰呮窐姹皘娣樻卑/.test(status)) return fills.retire;
    if (/鎭㈠/.test(status)) return fills.restore;
    if (row.modifiedFields?.length || row.customPlacement) return fills.changed;
    if (calc.external > 0) return fills.external;
    return fills.normal;
  }

  function applyCellStyle(cell, fill, fontColor, bold) {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    cell.font = { name: 'Microsoft YaHei', size: 10, color: { argb: fontColor || 'FF24332D' }, bold: !!bold };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = thinBorder;
  }

  function safeMerge(sheet, startRow, startCol, endRow, endCol) {
    if (startRow === endRow && startCol === endCol) return;
    sheet.mergeCells(startRow, startCol, endRow, endCol);
  }

  function buildPlanogramModel() {
    const state = appState();
    const store = currentStore();
    const current = appCurrent();
    const category4 = current.闄堝垪鍥惧洓绾?|| document.getElementById('displayMapCategoryFilter')?.value || '';
    const allRows = includedRows(store).filter(function (row) { return !row.inStaging; });
    const visibleRows = allRows.filter(function (row) { return !category4 || String(row.category4 || '').trim() === category4; });
    const cabinets = (state.cabinets || []).filter(function (cabinet) { return cabinet.store === store; });
    const usageMap = new Map(cabinetUsage().filter(function (cabinet) { return cabinet.store === store; }).map(function (cabinet) {
      return [cabinet.key, cabinet];
    }));
    const groups = new Map();
    cabinets.forEach(function (cabinet) {
      const label = cabinet.label || cabinet.key || '鏈懡鍚嶉檲鍒楁煖';
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(cabinet);
    });

    let maxPlanColumns = 12;
    const groupModels = Array.from(groups.entries()).map(function (entry) {
      const label = entry[0];
      const segments = entry[1];
      const segmentModels = segments.map(function (segment) {
        const allSegmentRows = allRows.filter(function (row) {
          return row.cabinetKey === segment.key || (cabinetLabel(row) === label && cabinetPosition(row) === segment.position);
        });
        const rows = visibleRows.filter(function (row) {
          return row.cabinetKey === segment.key || (cabinetLabel(row) === label && cabinetPosition(row) === segment.position);
        });
        const usage = usageMap.get(segment.key) || {};
        const capacity = number(segment.length);
        const used = Number.isFinite(Number(usage.used)) ? number(usage.used) : allSegmentRows.reduce(function (sum, row) { return sum + rowWidth(row); }, 0);
        const left = Number.isFinite(Number(usage.left)) ? number(usage.left) : capacity - used;
        const visibleUsed = rows.reduce(function (sum, row) { return sum + rowWidth(row); }, 0);
        const otherUsed = category4 ? Math.max(0, used - visibleUsed) : 0;
        const capacityCols = Math.max(1, Math.ceil(capacity / BASE_WIDTH_MM));
        const itemCols = rows.reduce(function (sum, row) { return sum + Math.max(1, Math.round(rowWidth(row) / BASE_WIDTH_MM)); }, 0);
        const otherCols = otherUsed > 0 ? Math.max(1, Math.round(otherUsed / BASE_WIDTH_MM)) : 0;
        maxPlanColumns = Math.max(maxPlanColumns, capacityCols, itemCols + otherCols);
        return { segment, rows, capacity, used, left, otherUsed, capacityCols };
      });
      return { label, type: cabinetType(segments[0] || {}), number: cabinetNumber(segments[0] || {}), segments: segmentModels };
    });
    return { state, store, category4, allRows, visibleRows, groups: groupModels, maxPlanColumns };
  }

  function writeMergedBlock(sheet, rowStart, rowEnd, colStart, colEnd, value, fill, fontColor, bold) {
    safeMerge(sheet, rowStart, colStart, rowEnd, colEnd);
    const cell = sheet.getCell(rowStart, colStart);
    cell.value = value;
    applyCellStyle(cell, fill, fontColor, bold);
    for (let row = rowStart; row <= rowEnd; row += 1) {
      for (let col = colStart; col <= colEnd; col += 1) {
        sheet.getCell(row, col).border = thinBorder;
      }
    }
  }

  function createPlanogramSheet(workbook, model) {
    const sheet = workbook.addWorksheet('闄堝垪鍥?, {
      views: [{ state: 'frozen', ySplit: 4 }],
      pageSetup: {
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        horizontalCentered: true,
        margins: { left: 0.25, right: 0.25, top: 0.45, bottom: 0.45, header: 0.2, footer: 0.2 }
      }
    });
    const infoCols = 4;
    const lastCol = infoCols + model.maxPlanColumns;
    sheet.getColumn(1).width = 16;
    sheet.getColumn(2).width = 12;
    sheet.getColumn(3).width = 12;
    sheet.getColumn(4).width = 12;
    for (let col = 5; col <= lastCol; col += 1) sheet.getColumn(col).width = 10.5;

    safeMerge(sheet, 1, 1, 1, lastCol);
    const title = sheet.getCell(1, 1);
    title.value = '鍐诲搧闂ㄥ簵闄堝垪鍥?;
    applyCellStyle(title, fills.title, 'FFFFFFFF', true);
    title.font = { name: 'Microsoft YaHei', size: 18, color: { argb: 'FFFFFFFF' }, bold: true };
    sheet.getRow(1).height = 32;

    safeMerge(sheet, 2, 1, 2, lastCol);
    const meta = sheet.getCell(2, 1);
    const generated = new Date().toLocaleString('zh-CN', { hour12: false });
    meta.value = '闂ㄥ簵锛? + model.store + '銆€锝溿€€瀵煎嚭鏃堕棿锛? + generated + '銆€锝溿€€鍥涚骇鍝佺被锛? + (model.category4 || '鍏ㄩ儴') + '銆€锝溿€€鏁版嵁鐗堟湰锛? + (model.state.meta?.version || model.state.meta?.source || '褰撳墠鐗?);
    applyCellStyle(meta, 'FFF7FAF8', 'FF33423C', false);
    meta.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    sheet.getRow(2).height = 24;

    safeMerge(sheet, 3, 1, 3, lastCol);
    const note = sheet.getCell(3, 1);
    note.value = '璇存槑锛氭墍鏈夊晢鍝佸潡鍧囦负鍙紪杈戝崟鍏冩牸锛涙í鍚戞瘡涓熀纭€鍒楃害浠ｈ〃50mm闄堝垪瀹藉害銆備慨鏀笶xcel涓嶄細鑷姩鍙嶅啓灏忕▼搴忋€?;
    applyCellStyle(note, 'FFFFFAE8', 'FF6B4B0F', false);
    note.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    sheet.getRow(3).height = 26;

    safeMerge(sheet, 4, 1, 4, lastCol);
    const legend = sheet.getCell(4, 1);
    legend.value = '棰滆壊锛氭甯搁檲鍒?娴呯豢銆€澶栧偍=娴呯伆銆€宸蹭慨鏀?娴呴粍銆€涓婃柊鎵ц涓?娴呰摑銆€娣樻卑鎵ц涓?娴呮銆€鎭㈠涓?娴呯传銆€绌轰綅=鐧借壊';
    applyCellStyle(legend, 'FFFFFFFF', 'FF596861', false);
    legend.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };

    let cursorRow = 6;
    model.groups.forEach(function (group) {
      safeMerge(sheet, cursorRow, 1, cursorRow, lastCol);
      const cabinetCell = sheet.getCell(cursorRow, 1);
      cabinetCell.value = group.label + '銆€锝溿€€' + group.type + '銆€锝溿€€' + (group.number || '鏈爣鏌滃彿') + '銆€锝溿€€' + group.segments.length + '涓綅缃?;
      applyCellStyle(cabinetCell, fills.section, 'FF183B2E', true);
      cabinetCell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
      sheet.getRow(cursorRow).height = 26;
      cursorRow += 1;

      group.segments.forEach(function (modelSegment) {
        const segment = modelSegment.segment;
        const rowStart = cursorRow;
        const rowEnd = cursorRow + 3;
        for (let row = rowStart; row <= rowEnd; row += 1) sheet.getRow(row).height = 22;
        writeMergedBlock(sheet, rowStart, rowEnd, 1, 1, segment.position || '鏈爣浣嶇疆', fills.header, 'FF24332D', true);
        writeMergedBlock(sheet, rowStart, rowEnd, 2, 2, '瀹归噺\n' + format(modelSegment.capacity, 0) + 'mm', fills.header, 'FF24332D', false);
        writeMergedBlock(sheet, rowStart, rowEnd, 3, 3, '宸茬敤\n' + format(modelSegment.used, 0) + 'mm', fills.header, 'FF24332D', false);
        writeMergedBlock(sheet, rowStart, rowEnd, 4, 4, '浣欓噺\n' + format(modelSegment.left, 0) + 'mm', modelSegment.left < 0 ? fills.danger : fills.header, modelSegment.left < 0 ? 'FF9B1C1C' : 'FF24332D', false);

        let col = 5;
        modelSegment.rows.forEach(function (row) {
          const calc = rowCalc(row);
          const width = rowWidth(row);
          const span = Math.max(1, Math.round(width / BASE_WIDTH_MM));
          const carton = Math.max(1, number(row.carton || 1));
          const maxBoxes = Math.max(0, Math.floor(number(calc.full) / carton));
          const value = [
            row.name || '鏈懡鍚嶅晢鍝?,
            row.barcode || '鏃犳潯鐮?,
            [row.category3, row.category4].filter(Boolean).join(' / '),
            format(row.displayCols, 0) + '鍒楋綔鍗曞垪' + format(row.perCol, 1) + '锝滄弧闄? + format(calc.full, 0),
            '鏈€澶? + maxBoxes + '绠憋綔鍗犲' + format(width, 0) + 'mm锝滃鍌? + format(calc.external, 0) + '浠?
          ].filter(Boolean).join('\n');
          writeMergedBlock(sheet, rowStart, rowEnd, col, col + span - 1, value, fillForRow(row, calc), 'FF24332D', true);
          col += span;
        });

        if (modelSegment.otherUsed > 0) {
          const span = Math.max(1, Math.round(modelSegment.otherUsed / BASE_WIDTH_MM));
          writeMergedBlock(sheet, rowStart, rowEnd, col, col + span - 1, '鍏朵粬绛涢€夊鍟嗗搧鍗犵敤\n' + format(modelSegment.otherUsed, 0) + 'mm', fills.other, 'FF596660', false);
          col += span;
        }

        const capacityEnd = 5 + modelSegment.capacityCols - 1;
        if (modelSegment.left > 0 && col <= capacityEnd) {
          writeMergedBlock(sheet, rowStart, rowEnd, col, capacityEnd, '鍙敤绌轰綅\n鍓╀綑' + format(modelSegment.left, 0) + 'mm', fills.free, 'FF65736D', false);
          col = capacityEnd + 1;
        }

        const maxEnd = 4 + model.maxPlanColumns;
        if (col <= maxEnd) {
          writeMergedBlock(sheet, rowStart, rowEnd, col, maxEnd, '', 'FFFFFFFF', 'FF65736D', false);
        }
        cursorRow = rowEnd + 1;
      });
      cursorRow += 1;
    });
    sheet.printArea = 'A1:' + sheet.getCell(Math.max(1, cursorRow - 1), lastCol).address;
    return sheet;
  }

  function createDetailSheet(workbook, model) {
    const sheet = workbook.addWorksheet('闄堝垪鏄庣粏', {
      views: [{ state: 'frozen', ySplit: 1 }],
      pageSetup: {
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        margins: { left: 0.25, right: 0.25, top: 0.45, bottom: 0.45, header: 0.2, footer: 0.2 }
      }
    });
    const columns = [
      ['闂ㄥ簵', 20], ['鍐版煖绫诲瀷', 12], ['闄堝垪鏌?, 20], ['鏌滃彿', 16], ['灞備綅/鍒嗗尯', 13],
      ['鍟嗗搧鍚嶇О', 26], ['鏉＄爜', 17], ['绛夌骇', 8], ['浜岀骇绫荤洰', 14], ['涓夌骇绫荤洰', 16], ['鍥涚骇绫荤洰', 16],
      ['闄堝垪鍒楁暟', 11], ['鍗曞垪瀹归噺', 11], ['婊￠檲鏁?, 10], ['绠辫', 9],
      ['鍟嗗搧闀縨m', 11], ['鍟嗗搧瀹絤m', 11], ['鍟嗗搧楂榤m', 11], ['鍗曞垪鍗犲mm', 12], ['鎬诲崰瀹絤m', 12],
      ['鏈€澶氬彲鏀剧鏁?, 13], ['澶栧偍浠舵暟', 10], ['澶栧偍绠辨暟', 10], ['澶栧偍浣撶НL', 11], ['鍛ㄨ浆椋庨櫓', 12],
      ['褰撳墠鐘舵€?, 14], ['淇敼璇存槑', 28]
    ];
    sheet.columns = columns.map(function (entry) { return { header: entry[0], key: entry[0], width: entry[1] }; });
    const header = sheet.getRow(1);
    header.height = 26;
    header.eachCell(function (cell) {
      applyCellStyle(cell, fills.header, 'FF27342F', true);
    });

    const state = model.state;
    const cabinetMap = new Map((state.cabinets || []).map(function (cabinet) { return [cabinet.key, cabinet]; }));
    model.visibleRows.forEach(function (row) {
      const cabinet = cabinetMap.get(row.cabinetKey) || {};
      const calc = rowCalc(row);
      const carton = Math.max(1, number(row.carton || 1));
      const width = rowWidth(row);
      const values = {
        '闂ㄥ簵': row.store || model.store,
        '鍐版煖绫诲瀷': cabinetType(cabinet),
        '闄堝垪鏌?: row.cabinetLabel || cabinet.label || '',
        '鏌滃彿': cabinetNumber(cabinet),
        '灞備綅/鍒嗗尯': row.position || cabinet.position || '',
        '鍟嗗搧鍚嶇О': row.name || '',
        '鏉＄爜': row.barcode || '',
        '绛夌骇': row.grade || '',
        '浜岀骇绫荤洰': row.category2 || '',
        '涓夌骇绫荤洰': row.category3 || '',
        '鍥涚骇绫荤洰': row.category4 || '',
        '闄堝垪鍒楁暟': number(row.displayCols),
        '鍗曞垪瀹归噺': number(row.perCol),
        '婊￠檲鏁?: number(calc.full),
        '绠辫': carton,
        '鍟嗗搧闀縨m': number(row.length),
        '鍟嗗搧瀹絤m': number(row.width),
        '鍟嗗搧楂榤m': number(row.height),
        '鍗曞垪鍗犲mm': number(row.faceWidth),
        '鎬诲崰瀹絤m': width,
        '鏈€澶氬彲鏀剧鏁?: Math.max(0, Math.floor(number(calc.full) / carton)),
        '澶栧偍浠舵暟': number(calc.external),
        '澶栧偍绠辨暟': Math.round(number(calc.external) / carton * 100) / 100,
        '澶栧偍浣撶НL': Math.round(number(calc.staticVol) * 100) / 100,
        '鍛ㄨ浆椋庨櫓': calc.risk || '',
        '褰撳墠鐘舵€?: row.lifecycleStatus || row.status || (row.included === false ? '鏈撼鍏? : '姝ｅ父闄堝垪'),
        '淇敼璇存槑': [row.changeNote, ...(row.modifiedFields || [])].filter(Boolean).join('锛?)
      };
      const excelRow = sheet.addRow(values);
      excelRow.height = 22;
      excelRow.eachCell(function (cell) {
        cell.font = { name: 'Microsoft YaHei', size: 10, color: { argb: 'FF27342F' } };
        cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
        cell.border = thinBorder;
      });
    });
    const lastCol = columns.length;
    const lastRow = Math.max(1, sheet.rowCount);
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: lastRow, column: lastCol } };
    sheet.getColumn('鏉＄爜').numFmt = '@';
    ['闄堝垪鍒楁暟', '鍗曞垪瀹归噺', '婊￠檲鏁?, '绠辫', '鍟嗗搧闀縨m', '鍟嗗搧瀹絤m', '鍟嗗搧楂榤m', '鍗曞垪鍗犲mm', '鎬诲崰瀹絤m', '鏈€澶氬彲鏀剧鏁?, '澶栧偍浠舵暟', '澶栧偍绠辨暟', '澶栧偍浣撶НL'].forEach(function (name) {
      sheet.getColumn(name).numFmt = '0.00';
    });
    return sheet;
  }

  function safeFilename(value) {
    return String(value || '').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').replace(/^_+|_+$/g, '') || '鏈懡鍚嶉棬搴?;
  }

  function timestamp() {
    const date = new Date();
    const pad = function (value) { return String(value).padStart(2, '0'); };
    return date.getFullYear() + pad(date.getMonth() + 1) + pad(date.getDate()) + '_' + pad(date.getHours()) + pad(date.getMinutes());
  }

  function notify(message) {
    try {
      if (typeof 瀹屾垚鎻愮ず === 'function') {
        瀹屾垚鎻愮ず(message);
        return;
      }
    } catch (_) {}
    alert(message);
  }

  async function exportExcelPlanogram() {
    const button = document.getElementById('exportDisplayMapBtn');
    const originalText = button?.textContent || '瀵煎嚭Excel闄堝垪鍥?;
    try {
      if (button) {
        button.disabled = true;
        button.textContent = '姝ｅ湪鐢熸垚Excel...';
      }
      await ensureExcelJS();
      const model = buildPlanogramModel();
      if (!model.store || !model.visibleRows.length) {
        alert('褰撳墠闂ㄥ簵鎴栫瓫閫夋潯浠朵笅娌℃湁鍙鍑虹殑闄堝垪鍟嗗搧銆?);
        return;
      }
      const workbook = new window.ExcelJS.Workbook();
      workbook.creator = '鍐诲搧鏁寸鍒板簵缁熶竴灏忕▼搴?;
      workbook.lastModifiedBy = '鍐诲搧鏁寸鍒板簵缁熶竴灏忕▼搴?;
      workbook.created = new Date();
      workbook.modified = new Date();
      workbook.calcProperties.fullCalcOnLoad = true;
      createPlanogramSheet(workbook, model);
      createDetailSheet(workbook, model);
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = '闂ㄥ簵闄堝垪鍥綺' + safeFilename(model.store) + '_' + timestamp() + '.xlsx';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
      notify('Excel闄堝垪鍥惧鍑哄畬鎴愶紝鍙洿鎺ュ湪Excel涓墜宸ヤ慨鏀广€?);
    } catch (error) {
      console.error('Excel闄堝垪鍥惧鍑哄け璐?, error);
      if (/ExcelJS|Excel缁勪欢|鍔犺浇澶辫触/.test(String(error?.message || error))) {
        alert('Excel缁勪欢鍔犺浇澶辫触锛岃妫€鏌ョ綉缁滃悗閲嶈瘯銆?);
      } else {
        alert('Excel闄堝垪鍥惧鍑哄け璐ワ紝璇烽噸璇曘€?);
      }
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = originalText === '瀵煎嚭闄堝垪鍥惧浘鐗? ? '瀵煎嚭Excel闄堝垪鍥? : originalText;
      }
    }
  }

  function bindExportButton() {
    const button = document.getElementById('exportDisplayMapBtn');
    if (!button) return false;
    button.textContent = '瀵煎嚭Excel闄堝垪鍥?;
    button.title = '瀵煎嚭鍙湪Excel/WPS涓墜宸ヤ慨鏀圭殑闄堝垪鍥?;
    button.onclick = function (event) {
      event.preventDefault();
      event.stopPropagation();
      exportExcelPlanogram();
    };
    button.dataset.excelExportBound = 'true';
    return true;
  }

  function waitForApp() {
    let attempts = 0;
    const timer = setInterval(function () {
      attempts += 1;
      if (installDirectHooks()) {
        clearInterval(timer);
        return;
      }
      if (attempts >= 240) {
        clearInterval(timer);
        console.error('闄堝垪鍥惧寮烘湭鑳藉湪24绉掑唴瀹屾垚鍒濆鍖栵紱宸插仠姝㈤噸璇曪紝涓嶅奖鍝嶄富绋嬪簭缁х画杩愯銆?);
      }
    }, 100);
  }

  installPoolSearchFix();
  waitForApp();
})();

