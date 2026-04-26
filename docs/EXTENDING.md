# 扩展点说明

当前项目已将 GUI 与计算逻辑分离，扩展建议优先围绕服务层进行。

## 1. 工作流扩展点

`elisa_calculator/services/workflow.py` 的 `run_calculation_workflow(...)` 支持注入：

- `table_reader`: 原始文本 -> DataFrame
- `calculator`: DataFrame -> (results, status_msg, removed_count, detail)
- `output_dir_factory`: 生成输出目录
- `output_saver`: 持久化结果与图像

这 4 个函数都可以替换，用于实现自定义数据源、自定义算法和自定义导出。

## 2. 新增算法的推荐方式

1. 在 `elisa_calculator/core` 新增算法模块（例如 `five_pl.py`）。
2. 保持返回结构与现有 `calculate_ec50_global_df` 一致，避免上层改动。
3. 在 GUI 或 CLI 中调用 `run_calculation_workflow(..., calculator=your_calculator)`。

## 3. 新增导出的推荐方式

1. 保留现有 `detail` 数据结构。
2. 自定义 `output_saver(detail_obj, output_dir)`，返回已保存文件列表。
3. 注入 `run_calculation_workflow(..., output_saver=your_saver)`。

## 4. 新增命令行入口（建议）

可创建 `elisa_calculator/cli.py`：

- 读取文件文本
- 调用 `run_calculation_workflow`
- 打印 `format_results_table`

这样可复用现有核心逻辑，不影响 GUI。
