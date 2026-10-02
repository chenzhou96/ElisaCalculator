import { useState } from "react";
import type { Workspace } from "./model";
import { Card, Empty } from "./Primitives";
export default function PlotsPanel({ state }: { state: Workspace }) {
  const [index, setIndex] = useState(0);
  const previews = state.result?.previews ?? [];
  const selected = previews[Math.min(index, previews.length - 1)];
  if (!selected)
    return (
      <Empty title="暂无曲线预览">
        运行分析后显示拟合图，无需启用文件导出
        {state.result?.preview_warnings?.length
          ? `。${state.result.preview_warnings.join("；")}`
          : ""}
      </Empty>
    );
  return (
    <Card
      title="拟合曲线"
      subtitle="图像来自本次计算；关闭导出也可查看"
      className="plot-card"
      action={
        <select
          aria-label="选择预览曲线"
          value={Math.min(index, previews.length - 1)}
          onChange={(e) => setIndex(Number(e.target.value))}
        >
          {previews.map((preview, i) => (
            <option key={preview.id} value={i}>
              {preview.group_name || "全部曲线"}
            </option>
          ))}
        </select>
      }
    >
      <div className="plot-canvas">
        <img
          src={selected.data_url}
          alt={`${selected.group_name || "全部曲线"} 4PL 拟合曲线`}
        />
      </div>
      <div className="plot-footer">
        <span>横轴为 log10 剂量；绝对浓度与相对剂量请核对标签</span>
        <span>
          {Math.min(index, previews.length - 1) + 1} / {previews.length}
        </span>
      </div>
    </Card>
  );
}
