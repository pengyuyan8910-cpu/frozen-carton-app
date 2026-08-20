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
      if (typeof 状态 !== 'undefined' && 状态) return 状态;
    } catch (_) {}
    return window.UNIFIED_CARTON_DATA || {};
  }

  function appCurrent() {
    try {
      if (typeof 当前 !== 'undefined' && 当前) return 当前;
    } catch (_) {}
    return {};
  }

  function currentStore() {
    try {
      if (typeof 门店名 === 'function') return 门店名();
    } catch (_) {}
    return document.getElementById('storeSelect')?.value || '';
  }

  function includedRows(store) {
    try {
      if (typeof 纳入SKU === 'function') return 纳入SKU(store);
    } catch (_) {}
    return (appState().skus || []).filter(function (row) {
      return row.store === store && row.included !== false;
    });
  }

  function rowCalc(row) {
    try {
      if (typeof 计算SKU === 'function') return 计算SKU(row);
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
    const risk = external <= 0 ? '无外储' : externalDays <= 15 ? '低风险' : externalDays <= 45 ? '中风险' : externalDays <= 90 ? '高风险' : '极高风险';
    return { full, trigger, receivable, inShelf, external, vol, staticVol, risk };
  }

  function displayDirection(row) {
    try {
      if (typeof 陈列面方向值 === 'function') {
        return 陈列面方向值(row) === 'length' ? '长做陈列面' : '宽做陈列面';
      }
    } catch (_) {}
    const value = String(row?.faceOrientation || '').trim();
    if (value === 'length' || value === '长做陈列面' || value === '长') return '长做陈列面';
    if (value === 'width' || value === '宽做陈列面' || value === '宽') return '宽做陈列面';
    const face = number(row?.faceWidth);
    const length = number(row?.length);
    const width = number(row?.width);
    if (face > 0 && length > 0 && width > 0) {
      return Math.abs(face - length) <= Math.abs(face - width) ? '长做陈列面' : '宽做陈列面';
    }
    return '';
  }

  function rowWidth(row) {
    try {
      if (typeof SKU占用宽度 === 'function') return SKU占用宽度(row);
    } catch (_) {}
    return Math.max(0, number(row.displayCols) * number(row.faceWidth));
  }

  function cabinetUsage() {
    try {
      if (typeof 柜段使用 === 'function') return 柜段使用();
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
      if (typeof 柜名 === 'function') return 柜名(row);
    } catch (_) {}
    return row.cabinetLabel || '';
  }

  function cabinetPosition(row) {
    try {
      if (typeof 柜位 === 'function') return 柜位(row);
    } catch (_) {}
    return row.position || '';
  }

  function cabinetType(cabinet) {
    try {
      if (typeof 冰柜类型 === 'function') return 冰柜类型(cabinet);
    } catch (_) {}
    const value = [cabinet?.kind, cabinet?.label].filter(Boolean).join(' ');
    if (/冰淇淋|雪糕|冰品/.test(value)) return '冰淇淋柜';
    if (/立柜/.test(value)) return '立柜';
    if (/卧柜/.test(value)) return '卧柜';
    return cabinet?.kind || '其他';
  }

  function cabinetNumber(cabinet) {
    try {
      if (typeof 柜号 === 'function') return 柜号(cabinet);
    } catch (_) {}
    return cabinet?.label || '';
  }

  function selectedSku(card) {
    const meta = text(card.querySelector('.selection-meta'));
    const barcode = (meta.split(/[｜|]/)[0] || '').trim();
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
    info.innerHTML = '<div><span>箱规</span><strong>' + (number(sku.carton) || 0) + ' 件/箱</strong></div>' +
      '<div><span>单列占宽</span><strong>' + (number(sku.faceWidth) || 0) + ' mm</strong></div>';
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
      if (typeof 定位到陈列图商品 === 'function') {
        定位到陈列图商品 = safeLocate;
        window.定位到陈列图商品 = safeLocate;
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
        empty.textContent = '没有匹配的商品';
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
        '<input type="search" class="category-picker-search" placeholder="搜索四级品类">' +
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
    toggle.textContent = selected ? selected.textContent : '全部四级品类';
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
      ready = typeof 渲染陈列图 === 'function' &&
        typeof 渲染陈列图右侧 === 'function' &&
        typeof 定位到陈列图商品 === 'function';
    } catch (_) {}
    if (!ready) return false;

    const originalRenderSide = 渲染陈列图右侧;
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
    渲染陈列图右侧 = wrappedRenderSide;
    window.渲染陈列图右侧 = wrappedRenderSide;

    const originalRenderMap = 渲染陈列图;
    const wrappedRenderMap = function () {
      const result = originalRenderMap.apply(this, arguments);
      syncCategoryPicker();
      applyPoolFilter();
      trimPlanogramSpace();
      return result;
    };
    wrappedRenderMap.__stablePlanogramFix = true;
    渲染陈列图 = wrappedRenderMap;
    window.渲染陈列图 = wrappedRenderMap;

    定位到陈列图商品 = safeLocate;
    window.定位到陈列图商品 = safeLocate;

    try {
      if (typeof 导出陈列图 === 'function') {
        导出陈列图 = exportExcelPlanogram;
        window.导出陈列图 = exportExcelPlanogram;
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
    bindPdfExportButton();
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
        else reject(new Error('ExcelJS未正确加载'));
      };
      script.onerror = function () { reject(new Error('ExcelJS加载失败')); };
      document.head.appendChild(script);
    });
  }

  function ensureExcelJS() {
    if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
    if (excelJsPromise) return excelJsPromise;
    excelJsPromise = loadScript(EXCELJS_PRIMARY).catch(function () {
      return loadScript(EXCELJS_FALLBACK);
    }).then(function () {
      if (!window.ExcelJS) throw new Error('Excel组件加载失败');
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
    if (/待上新|上新/.test(status)) return fills.launch;
    if (/待淘汰|淘汰/.test(status)) return fills.retire;
    if (/恢复/.test(status)) return fills.restore;
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
    const category4 = current.陈列图四级 || document.getElementById('displayMapCategoryFilter')?.value || '';
    const allRows = includedRows(store).filter(function (row) { return !row.inStaging; });
    const visibleRows = allRows.filter(function (row) { return !category4 || String(row.category4 || '').trim() === category4; });
    const cabinets = (state.cabinets || []).filter(function (cabinet) { return cabinet.store === store; });
    const usageMap = new Map(cabinetUsage().filter(function (cabinet) { return cabinet.store === store; }).map(function (cabinet) {
      return [cabinet.key, cabinet];
    }));
    const groups = new Map();
    cabinets.forEach(function (cabinet) {
      const label = cabinet.label || cabinet.key || '未命名陈列柜';
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
    const sheet = workbook.addWorksheet('陈列图', {
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
    title.value = '冻品门店陈列图';
    applyCellStyle(title, fills.title, 'FFFFFFFF', true);
    title.font = { name: 'Microsoft YaHei', size: 18, color: { argb: 'FFFFFFFF' }, bold: true };
    sheet.getRow(1).height = 32;

    safeMerge(sheet, 2, 1, 2, lastCol);
    const meta = sheet.getCell(2, 1);
    const generated = new Date().toLocaleString('zh-CN', { hour12: false });
    meta.value = '门店：' + model.store + '　｜　导出时间：' + generated + '　｜　四级品类：' + (model.category4 || '全部') + '　｜　数据版本：' + (model.state.meta?.version || model.state.meta?.source || '当前版');
    applyCellStyle(meta, 'FFF7FAF8', 'FF33423C', false);
    meta.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    sheet.getRow(2).height = 24;

    safeMerge(sheet, 3, 1, 3, lastCol);
    const note = sheet.getCell(3, 1);
    note.value = '说明：所有商品块均为可编辑单元格；横向每个基础列约代表50mm陈列宽度。修改Excel不会自动反写小程序。';
    applyCellStyle(note, 'FFFFFAE8', 'FF6B4B0F', false);
    note.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    sheet.getRow(3).height = 26;

    safeMerge(sheet, 4, 1, 4, lastCol);
    const legend = sheet.getCell(4, 1);
    legend.value = '颜色：正常陈列=浅绿　外储=浅灰　已修改=浅黄　上新执行中=浅蓝　淘汰执行中=浅橙　恢复中=浅紫　空位=白色';
    applyCellStyle(legend, 'FFFFFFFF', 'FF596861', false);
    legend.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };

    let cursorRow = 6;
    model.groups.forEach(function (group) {
      safeMerge(sheet, cursorRow, 1, cursorRow, lastCol);
      const cabinetCell = sheet.getCell(cursorRow, 1);
      cabinetCell.value = group.label + '　｜　' + group.type + '　｜　' + (group.number || '未标柜号') + '　｜　' + group.segments.length + '个位置';
      applyCellStyle(cabinetCell, fills.section, 'FF183B2E', true);
      cabinetCell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
      sheet.getRow(cursorRow).height = 26;
      cursorRow += 1;

      group.segments.forEach(function (modelSegment) {
        const segment = modelSegment.segment;
        const rowStart = cursorRow;
        const rowEnd = cursorRow + 3;
        for (let row = rowStart; row <= rowEnd; row += 1) sheet.getRow(row).height = 22;
        writeMergedBlock(sheet, rowStart, rowEnd, 1, 1, segment.position || '未标位置', fills.header, 'FF24332D', true);
        writeMergedBlock(sheet, rowStart, rowEnd, 2, 2, '容量\n' + format(modelSegment.capacity, 0) + 'mm', fills.header, 'FF24332D', false);
        writeMergedBlock(sheet, rowStart, rowEnd, 3, 3, '已用\n' + format(modelSegment.used, 0) + 'mm', fills.header, 'FF24332D', false);
        writeMergedBlock(sheet, rowStart, rowEnd, 4, 4, '余量\n' + format(modelSegment.left, 0) + 'mm', modelSegment.left < 0 ? fills.danger : fills.header, modelSegment.left < 0 ? 'FF9B1C1C' : 'FF24332D', false);

        let col = 5;
        modelSegment.rows.forEach(function (row) {
          const calc = rowCalc(row);
          const width = rowWidth(row);
          const span = Math.max(1, Math.round(width / BASE_WIDTH_MM));
          const value = [
            row.name || '未命名商品',
            row.barcode || '无条码',
            format(row.displayCols, 0) + '列｜单列' + format(row.perCol, 1) + '｜满陈' + format(calc.full, 0),
            '陈列面：' + displayDirection(row) + '｜占宽' + format(width, 0) + 'mm｜外储' + format(calc.external, 0) + '件'
          ].filter(Boolean).join('\n');
          writeMergedBlock(sheet, rowStart, rowEnd, col, col + span - 1, value, fillForRow(row, calc), 'FF24332D', true);
          col += span;
        });

        if (modelSegment.otherUsed > 0) {
          const span = Math.max(1, Math.round(modelSegment.otherUsed / BASE_WIDTH_MM));
          writeMergedBlock(sheet, rowStart, rowEnd, col, col + span - 1, '其他筛选外商品占用\n' + format(modelSegment.otherUsed, 0) + 'mm', fills.other, 'FF596660', false);
          col += span;
        }

        const capacityEnd = 5 + modelSegment.capacityCols - 1;
        if (modelSegment.left > 0 && col <= capacityEnd) {
          writeMergedBlock(sheet, rowStart, rowEnd, col, capacityEnd, '可用空位\n剩余' + format(modelSegment.left, 0) + 'mm', fills.free, 'FF65736D', false);
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
    const sheet = workbook.addWorksheet('陈列明细', {
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
      ['门店', 20], ['冰柜类型', 12], ['陈列柜', 20], ['柜号', 16], ['层位/分区', 13],
      ['商品名称', 26], ['条码', 17], ['等级', 8], ['二级类目', 14], ['三级类目', 16], ['四级类目', 16],
      ['陈列列数', 11], ['单列容量', 11], ['满陈数', 10], ['箱规', 9],
      ['商品长mm', 11], ['商品宽mm', 11], ['商品高mm', 11], ['单列占宽mm', 12], ['总占宽mm', 12],
      ['最多可放箱数', 13], ['外储件数', 10], ['外储箱数', 10], ['外储体积L', 11], ['周转风险', 12],
      ['当前状态', 14], ['修改说明', 28]
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
        '门店': row.store || model.store,
        '冰柜类型': cabinetType(cabinet),
        '陈列柜': row.cabinetLabel || cabinet.label || '',
        '柜号': cabinetNumber(cabinet),
        '层位/分区': row.position || cabinet.position || '',
        '商品名称': row.name || '',
        '条码': row.barcode || '',
        '等级': row.grade || '',
        '二级类目': row.category2 || '',
        '三级类目': row.category3 || '',
        '四级类目': row.category4 || '',
        '陈列列数': number(row.displayCols),
        '单列容量': number(row.perCol),
        '满陈数': number(calc.full),
        '箱规': carton,
        '商品长mm': number(row.length),
        '商品宽mm': number(row.width),
        '商品高mm': number(row.height),
        '单列占宽mm': number(row.faceWidth),
        '总占宽mm': width,
        '最多可放箱数': Math.max(0, Math.floor(number(calc.full) / carton)),
        '外储件数': number(calc.external),
        '外储箱数': Math.round(number(calc.external) / carton * 100) / 100,
        '外储体积L': Math.round(number(calc.staticVol) * 100) / 100,
        '周转风险': calc.risk || '',
        '当前状态': row.lifecycleStatus || row.status || (row.included === false ? '未纳入' : '正常陈列'),
        '修改说明': [row.changeNote, ...(row.modifiedFields || [])].filter(Boolean).join('；')
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
    sheet.getColumn('条码').numFmt = '@';
    ['陈列列数', '单列容量', '满陈数', '箱规', '商品长mm', '商品宽mm', '商品高mm', '单列占宽mm', '总占宽mm', '最多可放箱数', '外储件数', '外储箱数', '外储体积L'].forEach(function (name) {
      sheet.getColumn(name).numFmt = '0.00';
    });
    return sheet;
  }

  function safeFilename(value) {
    return String(value || '').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').replace(/^_+|_+$/g, '') || '未命名门店';
  }

  function timestamp() {
    const date = new Date();
    const pad = function (value) { return String(value).padStart(2, '0'); };
    return date.getFullYear() + pad(date.getMonth() + 1) + pad(date.getDate()) + '_' + pad(date.getHours()) + pad(date.getMinutes());
  }

  function notify(message) {
    try {
      if (typeof 完成提示 === 'function') {
        完成提示(message);
        return;
      }
    } catch (_) {}
    alert(message);
  }

  function exportPdfPlanogram() {
    const canvas = document.getElementById('displayMapCanvas');
    if (!canvas || !canvas.innerText.trim()) {
      alert('请先生成陈列图');
      return;
    }
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('PDF导出窗口被浏览器拦截，请允许本站打开新窗口后重试。');
      return;
    }
    const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
      .map(function (node) { return node.outerHTML; })
      .join('\n');
    const bodyClass = document.body.className || '';
    const printStyles = '<style>' +
      '@page{size:landscape;margin:8mm}' +
      'html,body{margin:0!important;padding:0!important;background:#fff!important;overflow:visible!important}' +
      'body{min-width:0!important}' +
      '.display-map-shell,#displayMapCanvas{width:max-content!important;max-width:none!important;height:auto!important;max-height:none!important;overflow:visible!important}' +
      '.display-map-shell{display:block!important;width:100%!important;max-width:100%!important}' +
      '#displayMapCanvas{display:block!important;width:100%!important;max-width:100%!important;min-width:0!important}' +
      '#displayMapCanvas>.map-cabinet{display:block!important;width:100%!important;break-before:page;page-break-before:always;break-inside:avoid;page-break-inside:avoid}' +
      '#displayMapCanvas>.map-store-title+.map-cabinet{break-before:auto;page-break-before:auto}' +
      '.map-item{break-inside:avoid}' +
      '</style>';
    printWindow.document.open();
    printWindow.document.write('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>冻品门店陈列图</title>' + styles + printStyles + '</head><body class="' + bodyClass + '"><div class="display-map-shell">' + canvas.outerHTML + '</div></body></html>');
    printWindow.document.close();
    let printed = false;
    const triggerPrint = function () {
      if (printed) return;
      printed = true;
      printWindow.focus();
      printWindow.print();
    };
    printWindow.addEventListener('load', function () { setTimeout(triggerPrint, 120); }, { once: true });
    setTimeout(triggerPrint, 700);
  }

  async function exportExcelPlanogram() {
    const button = document.getElementById('exportDisplayMapBtn');
    const originalText = button?.textContent || '导出Excel陈列图';
    try {
      if (button) {
        button.disabled = true;
        button.textContent = '正在生成Excel...';
      }
      await ensureExcelJS();
      const model = buildPlanogramModel();
      if (!model.store || !model.visibleRows.length) {
        alert('当前门店或筛选条件下没有可导出的陈列商品。');
        return;
      }
      const workbook = new window.ExcelJS.Workbook();
      workbook.creator = '冻品整箱到店统一小程序';
      workbook.lastModifiedBy = '冻品整箱到店统一小程序';
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
      link.download = '门店陈列图_' + safeFilename(model.store) + '_' + timestamp() + '.xlsx';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
      notify('Excel陈列图导出完成，可直接在Excel中手工修改。');
    } catch (error) {
      console.error('Excel陈列图导出失败', error);
      if (/ExcelJS|Excel组件|加载失败/.test(String(error?.message || error))) {
        alert('Excel组件加载失败，请检查网络后重试。');
      } else {
        alert('Excel陈列图导出失败，请重试。');
      }
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = originalText === '导出陈列图图片' ? '导出Excel陈列图' : originalText;
      }
    }
  }

  function bindExportButton() {
    const button = document.getElementById('exportDisplayMapBtn');
    if (!button) return false;
    button.textContent = '导出Excel陈列图';
    button.title = '导出可在Excel/WPS中手工修改的陈列图';
    button.onclick = function (event) {
      event.preventDefault();
      event.stopPropagation();
      exportExcelPlanogram();
    };
    button.dataset.excelExportBound = 'true';
    return true;
  }

  function bindPdfExportButton() {
    const button = document.getElementById('exportDisplayMapPdfBtn');
    if (!button) return false;
    button.onclick = function (event) {
      event.preventDefault();
      event.stopPropagation();
      exportPdfPlanogram();
    };
    button.dataset.pdfExportBound = 'true';
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
        console.error('陈列图增强未能在24秒内完成初始化；已停止重试，不影响主程序继续运行。');
      }
    }, 100);
  }

  installPoolSearchFix();
  waitForApp();
})();
