# ELISA Calculator 0.2

本地桌面科研分析工作台：比较抗体/试剂的剂量–响应曲线及参比倍数，或用标准曲线反算未知样本。Tauri 2 + React/TypeScript 界面，Python/SciPy 计算引擎；数据留在本机。

## 96 孔板工作台

默认打开 8×12 孔板：粘贴 Excel 读数（含空单元）→ 单孔、多选、框选或整列选孔 → 分配曲线、标准、未知、空白或排除类型 → 预览各组独立稀释梯度 → 检查逐孔映射 → 解析并运行。撤销/重做和记录保存保留完整板图；“表格输入”继续支持原有工作流，两份原始输入分别保留，不自动转换。

完整操作、相对原液分数、空白和复孔约定见 [孔板工作台说明](docs/PLATE_WORKBENCH.md)。

## 科研工作流

- **曲线比较**：CSV/TSV/文本粘贴 → 确认表头与列 → 选择 X 语义与拟合模式 → 选择参比及其 1X/10X 等赋值 → 查看结果、质量警告与曲线
- **标准定量**：准备标准曲线 → 指定标准组 → 输入未知样本响应及稀释倍数 → 查看插值/范围检查及校正结果
- X 支持原始浓度、log10 浓度，以及常用的 1–8 稀释序号。序号模式默认越大稀释越多，倍数可配；起始浓度未知时只给相对剂量，绝不伪造绝对浓度
- 独立/共享平台拟合显式选择；空白和复孔处理显式设置
- 图预览不依赖导出；输入或设置变化后旧结果失效

详细公式、适用假设与参比倍数解释见 [科学模型说明](docs/SCIENTIFIC_MODEL.md)。演示数据仅用于软件验证，不是实验结论。

## 运行环境

Python 3.10+、Node.js 24.15+（源码开发与测试要求；已验证 24.19，打包后的桌面版用户不需要 Node）；原生桌面还需要 Rust、平台 Tauri 系统依赖。Windows 打包需要 Visual Studio C++ Build Tools / Windows SDK。

```sh
python -m pip install -r requirements.txt
cd desktop-ui
npm ci
npm run tauri:dev
```

开发桌面版通过系统 `python` / Windows `py -3` 调用 Python；Windows release 构建执行 PyInstaller 脚本并优先使用内置 bridge executable，失败时才回退系统 Python。实际安装包需在 Windows 构建并验证，不能以网页构建替代。

## 本地浏览器集成验证

只用于开发，不是联网部署：

```sh
cd desktop-ui
VITE_ELISA_DEV_BRIDGE=1 npm run dev
```

浏览器打开 http://127.0.0.1:1420。这个显式启用的开发适配器仅接受回环客户端、同源 JSON 请求，调用同一 Python 引擎；不会允许任意文件读取或任意命令。未启用适配器的普通浏览器不会伪造计算结果。Windows PowerShell 先执行 `$env:VITE_ELISA_DEV_BRIDGE='1'`。

## 验证

```sh
python -m unittest discover -s tests -v
cd desktop-ui
npm run build
npm run lint
```

前端交互、端到端脚本见 `desktop-ui/tests/` 及 package.json 的测试命令。无可写用户目录的 CI 环境应把 `XDG_CACHE_HOME`、`MPLCONFIGDIR` 设置到可写临时目录。

测试覆盖应包括真值曲线、稀释方向、参比赋值、反算往返、非法/非有限输入、范围与不确定性、旧结果失效、失败导出及常见桌面窗口布局。测试通过仅证明所覆盖的软件行为，不等于实验方法已验证。

## 导出与分析记录

导出写入平台应用缓存目录下唯一的分析目录，路径显示在结果中：

- `EC50_Summary.csv`：曲线摘要
- `Unknown_Samples.csv`：未知样本结果（存在时）
- `Input_Audit.csv`：原始及处理数据追踪
- `Analysis_Record.json`：带版本、配置、完整报告与导出警告的规范记录
- 分组 PNG 与总览 PNG

界面“保存记录”生成的 `elisa-analysis/1` JSON 可用“恢复分析记录”恢复输入并重新计算。缓存中的 `Analysis_Record.json` 是完整科学审计格式，用于审阅或脚本复算，并不是界面状态文件。

请把需要长期保存的记录复制到实验项目目录。系统缓存不是长期存档位置。CSV 中可能被电子表格当成公式的用户文本会被转义；JSON 保留原值。

## Windows 发布

```sh
python -m pip install -r requirements-build.txt
cd desktop-ui
npm run tauri:build
```

内置 bridge 由 beforeBuildCommand 自动构建。构建会优先使用 BRIDGE_PYTHON_HOME 指定环境，否则自动检测 Python，不再依赖个人 D 盘路径。桥接必须使用 console 模式保留 JSON 标准输入/输出；Rust 的 CREATE_NO_WINDOW 负责隐藏窗口（[PyInstaller 说明](https://pyinstaller.org/en/stable/common-issues-and-pitfalls.html#sys-stdin-sys-stdout-and-sys-stderr-in-noconsole-windowed-applications-windows-only)）。离线安装工具准备脚本保留。发布前应在没有开发 Python 环境的干净 Windows 用户账户验证安装、启动、计算、中文输入、导出和卸载。源码更新不代表已经生成可分发安装包。

## 结构

`elisa_calculator/core` 科学计算；`io` 解析/导出；`services` 流程；`bridge.py` JSON 协议；`visualization` 预览和导出共用绘图；`desktop-ui` React 界面与 Rust 原生桥接；`tests` 回归测试。
