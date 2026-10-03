import type { Workspace } from "./model";
import type { Page } from "./types";

export interface InputProblem {
  page: Page;
  fields: string[];
  wells: string[];
  sampleIndex?: number;
}

/** Translate validation messages into the input controls that can resolve them. */
export function locateProblem(state: Workspace, messages: string[]): InputProblem {
  const message = messages[0] ?? "";
  if (state.inputView === "plate") {
    const wells = state.plate.wells.filter(w => messages.some(m => m.startsWith(`${w.id}：`))).map(w => w.id);
    const groupWells = state.plate.wells.filter(w => w.group && message.startsWith(`${w.group}：`)).map(w => w.id);
    const affected = wells.length ? wells : groupWells;
    let field = "";
    if (/参比组/.test(message)) field = "板图参比组";
    else if (/标准曲线引用/.test(message)) field = "板图标准曲线引用";
    else if (/参比赋值/.test(message)) field = "板图参比赋值（X）";
    else if (/绝对浓度和单位/.test(message)) field = "孔板剂量单位";
    else if (/明确单位/.test(message)) field = "板图浓度单位";
    else if (/空白/.test(message)) field = "空白校正作用域";
    else if (/未分配|标记或明确排除/.test(message)) field = "孔类型";
    else if (/读数/.test(message) && affected.length) field = `${affected[0]} 原始 OD`;
    else if (/组名|样品名/.test(message)) field = "组名 / 样品名";
    else if (/剂量|浓度/.test(message) && affected.length) field = "起始量 / 浓度";
    else if (/稀释校正/.test(message)) field = "未知样品稀释校正倍数";
    else if (/拟合曲线孔|未知样品孔|比较孔|孔类型|工作流/.test(message)) field = "孔类型";
    return {page: "data", fields: field ? [field] : [], wells: affected};
  }
  const unknownError = /未知样品|请输入有效 OD|稀释校正倍数/.test(message);
  if (unknownError) {
    const names = new Set<string>();
    const index = state.unknowns.findIndex(s => {
      const duplicate = !s.sample.trim() || names.has(s.sample.trim());
      names.add(s.sample.trim());
      if (/名称/.test(message)) return duplicate;
      return message.startsWith(`${s.sample}：`);
    });
    const suffix = Math.max(0, index) + 1;
    const prefix = /名称/.test(message) ? "样品名称" : /稀释/.test(message) ? "样品稀释倍数" : "样品 OD";
    return {page: "unknowns", fields: [`${prefix} ${suffix}`], wells: [], sampleIndex: Math.max(0, index)};
  }
  const rules: [RegExp, string][] = [
    [/重复孔|重复孔列/, "重复孔列映射（可选）"],
    [/连续稀释倍数/, "每级稀释倍数"], [/首个级数/, "首个级数"],
    [/起始浓度/, "起始浓度（可选）"], [/空白 OD/, "空白 OD"],
    [/参考组赋值/, "参考组赋值（X）"], [/参考组/, "参考组"],
    [/标准曲线/, "标准曲线"], [/浓度单位/, "浓度单位"],
  ];
  const field = rules.find(([pattern]) => pattern.test(message))?.[1];
  return {page: field ? "settings" : "data", fields: [field ?? "原始 ELISA 数据"], wells: []};
}
