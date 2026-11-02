import { assignWells, rectangleIds, ROWS, type Gradient, type PlateDocument } from "./plate.ts";

export interface ColumnBatch extends Pick<Gradient, "start" | "factor" | "direction"> {
  names: string;
  firstColumn: number;
  replicateColumns: number;
  firstRow: number;
  lastRow: number;
}
export interface BatchGroup { group: string; ids: string[]; firstDose: number; lastDose: number }
/** Explicit column layout only. Preview is pure; the caller commits one undoable plate edit. */
export function previewColumnBatch(plate: PlateDocument, draft: ColumnBatch): {plate: PlateDocument; groups: BatchGroup[]; ids: string[]} {
  const names = draft.names.replace(/\r\n?/g, "\n").split("\n").map(name => name.trim()).filter(Boolean);
  if (!names.length) throw new Error("每行填写一个组名；复孔列数由下方单独指定");
  if (new Set(names).size !== names.length) throw new Error("组名重复；同组复孔请设置每组复孔列数，不要重复填写组名");
  if (names.some(name => /\t/.test(name))) throw new Error("组名不能包含制表符；请每行填写一个组名");
  if (![draft.firstColumn, draft.replicateColumns, draft.firstRow, draft.lastRow].every(Number.isInteger) || draft.firstColumn < 1 || draft.replicateColumns < 1 || draft.firstRow < 0 || draft.lastRow > 7 || draft.firstRow > draft.lastRow) throw new Error("请选择有效的起始列、复孔列数和梯度行范围");
  if (draft.firstColumn + names.length * draft.replicateColumns - 1 > 12) throw new Error("分组超出第 12 列；请减少组数、复孔列数或调整起始列");
  const regions = names.map((group, index) => {
    const first = draft.firstColumn + index * draft.replicateColumns;
    return {group, ids: rectangleIds(`${ROWS[draft.firstRow]}${first}`, `${ROWS[draft.lastRow]}${first + draft.replicateColumns - 1}`)};
  });
  const ids = regions.flatMap(group => group.ids);
  if (plate.wells.some(well => !ids.includes(well.id) && ["comparison", "standard"].includes(well.kind) && names.includes(well.group))) throw new Error("区域外已有同名曲线；请改用新组名，或在“标记选中孔”中明确编辑已有组");
  let next = plate;
  const groups = regions.map(region => {
    next = assignWells(next, region.ids, {kind: "comparison", group: region.group, start: draft.start, factor: draft.factor, direction: draft.direction, axis: "column", spacing: "physical", dilution: 1});
    return {...region, firstDose: next.wells.find(well => well.id === region.ids[0])!.dose!, lastDose: next.wells.find(well => well.id === region.ids.at(-1))!.dose!};
  });
  return {plate: next, groups, ids};
}
