# ELISA Calculator 0.3.1

本地 96 孔板科研分析工作台：比较连续稀释组的剂量–响应曲线、EC50 和参比归一 X。Tauri 2 + React/TypeScript 界面，Python/SciPy 计算引擎；实验数据留在本机。

## 工作流

粘贴 Excel 的 8×12 读数（保留空单元与 0）→ 选孔 → 设置比较曲线、空白或排除 → 预览每组独立梯度 → 点击“应用到选中孔”→ 直接“运行分析”。映射检查和解析预览都是可选入口。

- 新分析只使用 96 孔板；待测样品也按连续稀释比较组处理，不再提供独立表格和标准曲线反算入口
- 全部设置统一在孔板右侧“分析约定”，左侧不再重复显示“分析设置”
- 选中已标记孔读取已有类型、组、起始量、倍数、方向和间隔；选中未分配孔恢复项目默认值。多选混合设置需明确替换，选择与编辑草稿不会写入孔板
- “应用到选中孔”才保存标记和单孔 OD 草稿；已有标记覆盖须确认，取消不修改，撤销/重做保留完整操作
- 结果页可更改成功拟合的参比组及正赋值，立即使用原始未舍入拟合与协方差重新归一，不重新拟合、不重新画图。例如参比 10X、样品 40X，改为样品 7X 后原参比为 1.75X
- 读数、孔位标记、剂量、空白、复孔或模型变化使旧结果失效；选择、配色与仅参比归一变化不会丢弃拟合

无量纲剂量允许任意有限正数，包括大于 1 的值，不解释为原液分数或物理浓度。已有绝对浓度须明确填写单位。共享/独立平台、空白作用域和复孔等权约定显式设置。非平行性、剂量范围、可辨识性、参比质量及条件置信区间警告保留；X 不是恒定生物效价的证明。

操作细节见 [孔板工作台](docs/PLATE_WORKBENCH.md)，模型和条件见 [科学说明](docs/SCIENTIFIC_MODEL.md)。示例均为软件验证合成数据。

## 自动保存与历史

桌面应用在应用数据目录自动保存完整会话与独立分析快照，包括全部板图、输入、未舍入结果、拟合、曲线预览、配置和参比设置；使用原子落盘。原生窗口关闭前会等待保存，失败时保留窗口并显示错误和重试入口。临时导出缓存与持久历史分开。

“分析历史”恢复完整计算快照，不调用 Python 重算，并标明“历史结果快照”；再次运行后标明重新分析状态。修改孔板或模型必须重新分析。便携“保存记录”生成 elisa-analysis/2 JSON，“恢复分析记录”也直接恢复经结构校验的 v2 结果。

旧版 elisa-analysis/1 只恢复输入，不把其中旧结果当作可信新结果。旧版表格、标准反算、未知孔及稀释信息完整保留，并显示兼容性提示；不会自动改义或丢弃。旧表格只能历史查看/另存，重新分析请新建孔板；旧标准/未知孔须明确重标记后再比较。旧版科学导出 Analysis_Record.json 是审计文件，不是界面恢复记录。

浏览器开发版使用本站 IndexedDB 的严格写入事务。隐私模式、清理站点数据或浏览器存储回收可能删除记录。重要实验仍应另存 JSON 到实验目录；自动保存不替代独立备份。

## 运行与验证

源码开发需要 Python 3.10+、Node.js 24.15+、Rust 和平台 Tauri 系统依赖。Windows installer 内置冻结 Python/SciPy bridge，用户不需要安装 Python、Node 或 Rust。Windows 10/11 x64 是兼容目标；具体最低版本及实际验证界限见 [Windows 验证](docs/WINDOWS_VALIDATION.md)。

启动窗口按当前显示器的实际工作区（扣除任务栏、原生边框并考虑 DPI）调整大小。150% 缩放的小屏使用紧凑孔板与可滚动右侧编辑器；正常 1366×768 / 1440×900 逻辑像素布局保留。所有 96 孔保持可见，导航按钮保留可访问名称和悬停提示。

```sh
python -m pip install -r requirements.txt
cd desktop-ui
npm ci
npm run tauri:dev
```

本地浏览器验证显式启用真实 Python 适配器：

```sh
VITE_ELISA_DEV_BRIDGE=1 npm run dev
```

该适配器只接受回环同源 JSON，不允许任意文件或命令，未启用时不会伪造结果。数值输入支持四则运算和括号，例如 =1/20、=(2+3)*4；原始输入保留供审计。日间/夜间配色保存在本机，不影响计算。

```sh
python -m unittest discover -s tests -v
cd desktop-ui
npm run build
npm run lint
npm test
npm run test:integration
npm run test:plate-science
npm run test:e2e
```

浏览器 CI 始终使用 Chromium sandbox；Ubuntu 24.04 采用 runner 已安装 Chrome 的显式路径 /opt/google/chrome/chrome，不修改 AppArmor、user namespace 或安全设置。测试通过仅说明覆盖的软件行为，不能代替实验方法验证。浏览器/DOM 测试不能代替真实 Windows 安装验收。

## 导出与 Windows 包

可选导出写入独立应用缓存目录：EC50_Summary.csv、Input_Audit.csv、完整 Analysis_Record.json、分组与总览 PNG。路径与实际保存失败明确显示。仅改变参比后旧导出不代表新的归一结果，新的完整快照仍自动保存；如需新 CSV/PNG，重新运行或保存新的分析记录。CSV 公式样式用户文本会安全转义，JSON 保留原文。

```sh
python -m pip install -r desktop-ui/scripts/requirements-windows-build.txt
cd desktop-ui
npm ci
npm run tauri:build
```

GitHub Actions 构建包含冻结 bridge 的 Windows NSIS 安装包，并提供 commit、依赖清单和 SHA-256。安装器包含离线 WebView2 安装器，可能较大；不把源码构建成功称为已实际安装成功。真实 Win11 与以后 Win10 验收必须按 Windows 文档逐项记录。

## 结构

elisa_calculator/core 为科学计算与无重拟合归一；io 为解析/导出；bridge.py 为 JSON 协议；desktop-ui 为 React、原生 Rust 桥接及持久快照。后端保留旧科学接口供历史兼容与回归核对，当前桌面新建工作流只提供孔板比较。
