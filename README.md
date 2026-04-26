# ElisaCalculator

ELISA 4PL Global Fit 工具，支持 GUI 导入/粘贴数据，进行共享 A/D 的全局拟合，并导出汇总与图片。
当前仓库包含两套界面：

- **Tk GUI**：原有 Python 桌面界面，兼容现有使用方式。
- **Tauri + React GUI**：新的现代桌面界面，前端使用 TypeScript / React，计算仍复用 Python 核心逻辑。

## 项目结构

```text
ElisaCalculator/
├── ElisaCalculator.py            # 薄入口（兼容）
├── desktop-ui/                   # 新的 Tauri + React 桌面界面
├── elisa_calculator/
│   ├── __main__.py               # python -m 入口
│   ├── app.py                    # 应用启动
│   ├── bridge.py                 # JSON 桥接层，供新 GUI 调用
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

### 运行原 Tk GUI

```bash
python -m elisa_calculator
```

兼容入口也可用：

```bash
python ElisaCalculator.py
```

### 运行新 Tauri + React GUI

先确保本机已安装：

1. Python 3
2. Node.js
3. Rust toolchain
4. Visual Studio C++ Build Tools / Windows SDK

然后在项目根目录执行：

```bash
cd desktop-ui
npm install
npm run tauri:dev
```

新 GUI 通过 `python -m elisa_calculator.bridge` 调用现有 Python 工作流，因此当前开发模式默认依赖本机可用的 `python` 或 `py -3` 命令。

## 测试

```bash
python -m unittest discover -s tests -v
```

前端构建检查：

```bash
cd desktop-ui
npm run build
```

## 发布（Windows）

### 1) 发布前检查

```bash
python -m unittest discover -s tests -v
cd desktop-ui
npm run tauri build -- --no-bundle
```

说明：`--no-bundle` 会先验证可执行文件可正常构建，产物为 `desktop-ui/src-tauri/target/release/app.exe`。

### 2) 生成安装包

```bash
cd desktop-ui
npm run tauri build -- --bundles nsis
```

如果网络受限，Tauri 可能在首次打包时下载 NSIS/WiX 失败（超时）。这是安装包工具链下载失败，不影响 `app.exe` 构建。

### 3) Python 运行依赖

当前桌面版通过 Python 桥接运行计算逻辑，目标机器需要可用的 Python 环境及依赖（如 numpy/pandas/scipy/matplotlib）。

本仓库已将 `elisa_calculator` 包作为 Tauri 资源纳入构建，发布版会在运行时自动查找资源目录。

### 4) 离线打包（无外网）

Tauri 已配置 `bundle.useLocalToolsDir=true`，会优先使用项目内缓存目录：`desktop-ui/src-tauri/target/.tauri`。

首次准备离线工具缓存：

```bash
cd desktop-ui
npm run tauri:prepare:offline-tools
```

离线构建命令：

```bash
cd desktop-ui
npm run tauri:build:nsis:offline
npm run tauri:build:msi:offline
```

## 扩展建议

1. 新增算法：在 `core` 增加新的拟合函数，并在 `services/workflow.py` 注入 `calculator`。
2. 新增导出：实现新的 `output_saver` 并注入工作流，可导出 Excel/JSON。
3. 新增入口：可基于 `services/workflow.py` 快速添加 CLI，而无需改 GUI 代码。

更多细节见 `docs/EXTENDING.md`。
