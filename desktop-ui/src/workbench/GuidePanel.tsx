import { Card } from "./Primitives";
export default function GuidePanel() {
  return (
    <div className="guide-layout">
      <Card
        title="01 · 曲线比较"
        subtitle="用同一稀释设计，比较 EC50 与参考归一强度"
      >
        <p>
          默认 X = 1…8，表示逐级稀释。选择 2–10
          倍稀释；级数越大，浓度越低。未知起始浓度时只使用相对剂量。
        </p>
        <div className="formula-box">
          <code>EC50 比值 = EC50样品 / EC50参考</code>
          <code>原液强度 = 参考赋值 × EC50参考 / EC50样品</code>
        </div>
        <p>
          例：同为两倍稀释，参考 EC50 在第 3.5 级，样品在第 5.5 级。样品可多稀释
          2 级，原液强度为参考的 4 倍；参考赋值 10 X 时，样品为 40 X。
        </p>
        <p className="muted">
          原液强度要求剂量尺度可比；不同起始浓度、单位、响应方向或曲线形态可能使比较无效。EC50
          不等于抗体亲和力。
        </p>
      </Card>
      <Card
        title="02 · 标准曲线反算"
        subtitle="已知标准浓度 → 未知样品孔内浓度 → 原样浓度"
      >
        <p>
          使用已知原始浓度、log10
          浓度，或已知起始浓度的稀释级数。指定标准组与单位，再输入未知样品 OD
          和稀释校正倍数。
        </p>
        <div className="formula-box">
          <code>处理后 OD = 原始 OD 均值 − 空白 OD</code>
          <code>原样浓度 = 曲线反算浓度 × 稀释倍数</code>
        </div>
        <p>
          例：孔内浓度 12 ng/mL，样品上板前稀释 5 倍，则原样为 60
          ng/mL。超出实测范围默认不反算；模型上下平台之外不可反算。
        </p>
        <p className="muted">
          不要用无已知浓度的相对曲线报告 ng/mL 等绝对单位。
        </p>
      </Card>
      <Card title="03 · 数据和质量" subtitle="先检查含义，再看拟合指标">
        <p>
          每列一个曲线；重复孔必须显式映射。空白默认不扣除；启用后同样用于标准与未知样品。共享
          A / D 模式要求响应平台一致。
        </p>
        <ul>
          <li>建议覆盖低、中、高响应区间，并包含重复孔</li>
          <li>查看 R²、RMSE、拟合曲线、EC50 范围与警告</li>
          <li>高 R² 不能补救平台不足、少量点或不合适的模型</li>
          <li>输入修改会清除旧结果，避免误用过期分析</li>
        </ul>
      </Card>
      <Card title="04 · 保存与恢复" subtitle="预览、导出和长期保存分别处理">
        <p>
          曲线预览与 CSV/PNG
          导出互不依赖。勾选运行后导出会写入应用缓存目录；它不是长期归档位置。
        </p>
        <p>
          “保存分析记录”下载
          JSON，包含原始数据、全部选项、未知样品和计算结果。通过文件菜单重新导入可恢复输入，重新计算后才显示有效结果。
        </p>
        <p className="muted">
          本工具用于研究数据分析，不用于直接作出临床诊断或治疗决策。
        </p>
      </Card>
    </div>
  );
}
