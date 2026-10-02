# 验证记录 · 2026-10-02

基于原仓库 main 提交 `98d6b40a250ed65a1e4b90d14aefaf4978e6b233`，本地版本 0.2.0。没有推送、合并或部署。

## 已执行

- Python 后端完整回归：84 项通过，包含解析、坐标、拟合、反算、失败路径、审计和导出
- 独立科学检查：40 项（属于上述 84 项），以独立浓度域 Hill 方程和解析雅可比为参照
- 前端状态/记录单元检查：35 项通过
- React DOM 交互 + 真实 Python 引擎：4 个集成测试套件通过。这里使用的是 DOM 测试环境，不是浏览器，不验证像素、排版或原生窗口
- TypeScript/Vite production build、ESLint、Python compileall、git diff --check 通过
- 本地开发桥接 HTTP 核验：真实两种请求结果正确；拒绝异源请求和任意文件读取请求
- Matplotlib 科学曲线预览实际生成，并检查代表性图像；这不是应用界面截图

## 科学真值与交互

二倍稀释中，参比中点 3.5、待测中点 5.5。参比赋值 10X → 待测 40X；参比赋值 2.5X → 待测 10X。标准反算测定液浓度 12 ng/mL，乘 5 倍稀释后为 60 ng/mL。越出标准范围默认不输出浓度。

集成测试还覆盖关闭磁盘导出仍有曲线、设置变化清除旧结果、上/下平台值和标签、UTF-8 文件读取、明确表头模式、无效数据、JSON 保存/恢复后必须重新解析、异步旧记录不能覆盖新输入、菜单退出和取消新建。

## 有限数值压力检查

固定随机种子，48 次拟合/96 条组曲线，8 个点，覆盖 2/3/5/10 倍稀释、不同中点和斜率、共享/独立平台。无噪声曲线的 EC50 相对误差 ≤1.2×10⁻¹⁵；加入响应幅度 0.1% 标准差高斯噪声时，此固定样本中最大 EC50 误差约 1.415%、表观原液比值误差约 1.549%、中点误差约 0.0172 级。

这些数字只描述所述合成模型测试，不能外推为真实实验准确度或方法学验证。

## iMac 实机补充验收

2026-10-02 的 iMac 本地验收记录确认：后端 84/84、前端单元 35/35、DOM + Python 4/4、真实 Chromium 浏览器 7/7、build/lint 通过。这里的浏览器及原生结论来自 iMac 验收记录，云端仅同步最终源码并重新执行可用的非浏览器检查。

- 修复数据预览区约 19 px 的内部溢出；真实浏览器在 1366×768 和 1440×900 下核验五行完整可见、无需内部或页面滚动
- 浏览器覆盖真实 Python 比较、标准反算、导出、记录恢复、输入变化清除旧结果及分页交互
- Mac 调试 Tauri `.app` 已构建并运行，两类实际计算流程通过
- Mac 配置仅使用相对资源路径，运行时经 PATH 查找 `python`；验收临时使用既有 Anaconda。当前 `.app` 仍依赖外部 Python，不是包含独立 Python 运行时的发行包
- 最终五文件补丁 SHA256：`6194f91c7904cb220abed57319d631f2eaa359ccb356de608818357fa7fec37e`；同步后五个源码文件逐一与 Mac 校验值吻合
- 最终 Mac 截图与跟踪文件上传未完成，因此此次附件不包含这些最终视觉证据；已有科学曲线 PNG 不是应用截图

## 尚未完成的验收

- Windows 原生构建、安装包与干净 Windows 安装测试
- 独立 Python 打包、干净 Mac 安装、Developer ID 签名及公证
- Mac 原生窗口精确两档尺寸、拖动和最小化专项验收（浏览器尺寸检查不能代替原生检查）
- 远程 CI：已新增工作流，但未推送，因此尚未运行

云端 Chromium 的 Unix socket EPERM 与云浏览器 localhost 阻挡仍存在；未绕过限制。最终源码同步阶段不重复云端浏览器启动。Windows 打包脚本修复仍需实际打包验收。

## 复现

```sh
python -m pip install -r requirements.txt
python -m unittest discover -s tests -v
cd desktop-ui
npm ci
npm run build
npm run lint
npm test
npm run test:integration
# 仅在允许运行浏览器的环境中：
npx playwright install --with-deps chromium
npm run test:e2e
```

科学参数约定与边界见 [SCIENTIFIC_MODEL.md](SCIENTIFIC_MODEL.md)，可重复请求和数据见 `examples/`。
