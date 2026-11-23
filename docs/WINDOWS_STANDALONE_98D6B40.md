# ElisaCalculator 旧版 Windows x64 独立安装包

基线是 `98d6b40a250ed65a1e4b90d14aefaf4978e6b233`。保留这个版本的界面与分析算法；本分支只调整安装、内置计算进程和验证流程。安装版本仍为 0.1.0，与主分支版本区别以分支及构建提交为准。

## 使用

从本分支成功的 GitHub Actions 运行下载 `ElisaCalculator-windows-x64-<提交>` 工件，解压后运行里面的 `*-setup.exe`。这是 x64 当前用户安装包。它包含离线 WebView2 安装程序、内置 CPython 3.12、数值计算库和应用私有的 Visual C++ DLL。目标机不需要另外装 Python、Conda、pip 包或手动配置 PATH。不要把装好的单个 `app.exe` 或 `elisa_bridge.exe` 从安装目录单独复制出去。

若已安装其它版本，先备份工作结果并留意安装目录，避免误覆盖既有版本。本包没有发布签名；在受企业策略管理的设备上需遵循组织软件准入规则。

## 为什么改打包

旧脚本依赖固定的 Conda 路径，并把 JSON 桥接打成没有标准输入输出的 `--windowed` 模式。现在用 x64 CPython 构建 PyInstaller `--onedir --console`，连同整个 `_internal` 目录安装。Rust 采用 `CREATE_NO_WINDOW`，处理 JSON 管道而不弹出命令行窗口。Windows 发布版固定从安装资源目录寻找桥接，检查关键文件，以桥接所在目录启动；即使旧源码路径或 Python 环境变量无效，也不回退到设备 Python。用户曾看到 Windows 的 `os error 267`（目录名称无效）；单凭提示不能确定旧安装包为何得到无效目录。

## 构建与验证

- 工作流使用官方 Windows Server 2022 x64 runner，Node 24、x64 CPython 3.12、Rust stable、Visual Studio 2022 C++ 工具链。Windows 构建固定使用脚本列出的 NumPy/pandas/SciPy/Matplotlib 版本。
- 本地构建需 VS 2022 C++ 工具链、Rust、Node 与 x64 Python 3.12。运行 `npm ci`，然后在 `desktop-ui` 下运行 `npm run tauri:build -- --ci --bundles nsis -- --locked`。这些是构建机依赖，不是用户运行时依赖。
- CI 在有空格和中文的目录安装，校验整个桥接负载的哈希；在无 Python PATH、错误的 Python／源码环境变量和无关的工作目录下，用已安装的 Rust 程序验证解析、已知答案的两组 4PL 及 CSV/PNG 导出，另测桌面窗口启动。安装包和 SHA-256、提交、runner、验证报告同包交付。
- Windows Server 验证不是原生 Windows 10 / 11 验收；建议实际目标为 Windows 10 22H2 与 Windows 11 x64，实际通过情况仅认对应客户系统的测试记录。企业策略、缺少系统更新或第三方防护拦截不在保证范围内。
