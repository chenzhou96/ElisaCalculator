# 可重复的合成验证示例

这些是数学合成数据，不来自真实实验。

- comparison_8_steps.csv：二倍递增稀释，参比中点3.5，待测中点5.5；参比10X时，待测应为40X（原液表观相对强度），参比1X时应为4X
- standards_ng_ml.csv：浓度单位ng/mL，标准EC50=8；未知样本Known_truth_12测定液浓度12，乘5倍稀释后为60ng/mL；Below_range应拒绝默认外推

运行：python -m elisa_calculator.bridge --request-file examples/comparison_request.json
标准定量：python -m elisa_calculator.bridge --request-file examples/standard_request.json

请求关闭持久导出，但结果仍应包含可预览曲线。
