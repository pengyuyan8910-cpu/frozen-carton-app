function text(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function preservePlanogramStagingSearchFocus(input, render, getInput) {
  const start = Number.isInteger(input?.selectionStart) ? input.selectionStart : null;
  const end = Number.isInteger(input?.selectionEnd) ? input.selectionEnd : start;
  render();
  const nextInput = getInput?.();
  if (!nextInput) return;
  nextInput.focus?.();
  if (start !== null) nextInput.setSelectionRange?.(start, end);
}

export function shouldSkipPlanogramStagingSearchRender(event, composing = false) {
  return Boolean(composing || event?.isComposing || event?.inputType === "insertCompositionText");
}

export function applyPlanogramStagingSearch(items, empty, rows, query = "") {
  const matches = new Set(filterPlanogramStagingRows(rows, query).map((row) => String(row?.id ?? "")));
  const filter = text(query);
  let visible = 0;
  (Array.isArray(items) ? items : []).forEach((item) => {
    const match = !filter || matches.has(String(item?.dataset?.skuId ?? ""));
    if (item) item.hidden = !match;
    if (match) visible += 1;
  });
  if (empty) empty.hidden = visible > 0 || !rows?.length || !filter;
  return visible;
}
export function filterPlanogramStagingRows(rows, query = "") {
  const filter = text(query);
  return (Array.isArray(rows) ? rows : []).filter((row) => (
    !filter || [row?.name, row?.barcode, row?.category2, row?.category3, row?.category4]
      .some((value) => text(value).includes(filter))
  ));
}
