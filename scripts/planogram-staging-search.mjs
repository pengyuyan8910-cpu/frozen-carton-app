function text(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function filterPlanogramStagingRows(rows, query = "") {
  const filter = text(query);
  return (Array.isArray(rows) ? rows : []).filter((row) => (
    !filter || [row?.name, row?.barcode, row?.category2, row?.category3, row?.category4]
      .some((value) => text(value).includes(filter))
  ));
}
