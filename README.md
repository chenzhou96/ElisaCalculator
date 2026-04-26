# ElisaCalculator

ELISA 4PL Global Fit 工具，支持 GUI 导入/粘贴数据，进行共享 A/D 的全局拟合，并导出汇总与图片。

## 项目结构

```text
ElisaCalculator/
├── ElisaCalculator.py            # 薄入口（兼容）
├── elisa_calculator/
│   ├── __main__.py               # python -m 入口
│   ├── app.py                    # 应用启动
│   ├── common.py                 # 通用工具
│   ├── core/                     # 模型与计算
│   ├── io/                       # 读取、写出、表格格式化
│   ├── visualization/            # 字体与绘图
│   ├── services/                 # 计算工作流编排（扩展点）
│   └── gui/                      # Tk 界面
├── tests/                        # 最小回归测试
└── docs/
    └── EXTENDING.md              # 扩展说明
```

## 运行

```bash
python -m elisa_calculator
```

兼容入口也可用：

```bash
python ElisaCalculator.py
```

## 测试

```bash
python -m unittest discover -s tests -v
```

## 扩展建议

1. 新增算法：在 `core` 增加新的拟合函数，并在 `services/workflow.py` 注入 `calculator`。
2. 新增导出：实现新的 `output_saver` 并注入工作流，可导出 Excel/JSON。
3. 新增入口：可基于 `services/workflow.py` 快速添加 CLI，而无需改 GUI 代码。

更多细节见 `docs/EXTENDING.md`。
