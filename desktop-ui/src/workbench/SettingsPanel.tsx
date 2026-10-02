import type { Dispatch } from "react";
import { availableGroups, type Action, type Workspace } from "./model";
import type { AnalysisOptions, InputMode } from "./types";
import { Card, Field } from "./Primitives";

export default function SettingsPanel({
  state,
  dispatch,
}: {
  state: Workspace;
  dispatch: Dispatch<Action>;
}) {
  const options = state.options;
  const set = (patch: Partial<AnalysisOptions>) =>
    dispatch({ type: "options", patch });
  const groups = availableGroups(state);
  const concentrationKnown =
    options.input_mode !== "dilution_step" ||
    options.start_concentration !== null;
  return (
    <div className="settings-layout">
      <Card
        title="剂量与坐标"
        subtitle="X 轴只转换一次；内部统一在 log10 浓度上拟合"
      >
        <Field label="输入方式">
          <select
            value={options.input_mode}
            onChange={(e) => set({ input_mode: e.target.value as InputMode })}
          >
            <option value="dilution_step">稀释级数（1、2、3…）</option>
            <option value="raw_concentration">原始浓度</option>
            <option value="log_concentration">已取 log10 的浓度</option>
          </select>
        </Field>
        {options.input_mode === "dilution_step" && (
          <>
            <div className="field-grid">
              <Field label="每级稀释倍数">
                <input
                  type="number"
                  min="2"
                  max="10"
                  step="any"
                  value={finite(options.dilution_factor)}
                  onChange={(e) =>
                    set({ dilution_factor: number(e.target.value) })
                  }
                />
              </Field>
              <Field label="首个级数">
                <input
                  type="number"
                  step="any"
                  value={finite(options.first_step)}
                  onChange={(e) => set({ first_step: number(e.target.value) })}
                />
              </Field>
            </div>
            <Field label="级数增加时">
              <select
                value={options.dilution_direction}
                onChange={(e) =>
                  set({
                    dilution_direction: e.target
                      .value as AnalysisOptions["dilution_direction"],
                  })
                }
              >
                <option value="increasing">稀释增加，浓度降低（默认）</option>
                <option value="decreasing">稀释减少，浓度升高</option>
              </select>
            </Field>
            <Field
              label="起始浓度（可选）"
              hint="留空仅计算相对剂量，不推断绝对浓度"
            >
              <input
                type="number"
                min="0"
                step="any"
                value={
                  options.start_concentration === null
                    ? ""
                    : finite(options.start_concentration)
                }
                placeholder="未知，保留相对剂量"
                onChange={(e) =>
                  set({
                    start_concentration:
                      e.target.value === "" ? null : number(e.target.value),
                  })
                }
              />
            </Field>
          </>
        )}
        <Field label="浓度单位">
          <input
            value={options.concentration_unit}
            disabled={!concentrationKnown}
            placeholder="例如 ng/mL、nM"
            onChange={(e) => set({ concentration_unit: e.target.value })}
          />
        </Field>
        <div className="formula-box">
          <span>
            {options.input_mode === "dilution_step" ? "剂量换算" : "坐标声明"}
          </span>
          {options.input_mode === "dilution_step" ? (
            <>
              <code>
                c(s) = c₀ × {finite(options.dilution_factor)}
                <sup>
                  {options.dilution_direction === "increasing" ? "−" : ""}(s −{" "}
                  {finite(options.first_step)})
                </sup>
              </code>
              <p>
                {concentrationKnown
                  ? "使用已知起始浓度与所填单位"
                  : "c₀ 未知：令起始相对剂量为 1；结果单位为 relative dose"}
              </p>
            </>
          ) : (
            <p>
              {options.input_mode === "raw_concentration"
                ? "每个 X 为正浓度；内部取 log10。0 浓度不能进入对数拟合。"
                : "每个 X 已经是 log10(c)；负值和 0 都是合法输入，不再取对数。"}
            </p>
          )}
        </div>
      </Card>
      <div className="settings-column">
        <Card
          title={
            options.workflow === "comparative" ? "参考与比较" : "标准与反算"
          }
          subtitle={
            options.workflow === "comparative"
              ? "明确指定参考，避免把 EC50 比值当作原液强度"
              : "标准必须具有已知浓度和单位"
          }
        >
          <div className="field-grid">
            <Field
              label={options.workflow === "comparative" ? "参考组" : "标准曲线"}
            >
              <select
                value={
                  (options.workflow === "comparative"
                    ? options.reference_group
                    : options.standard_group) ?? ""
                }
                onChange={(e) =>
                  set(
                    options.workflow === "comparative"
                      ? { reference_group: e.target.value || null }
                      : { standard_group: e.target.value || null },
                  )
                }
              >
                <option value="">请选择组</option>
                {groups.map((group) => (
                  <option key={group}>{group}</option>
                ))}
              </select>
            </Field>
            {options.workflow === "comparative" && (
              <Field label="参考组赋值（X）">
                <input
                  type="number"
                  min="0"
                  step="any"
                  list="reference-presets"
                  value={finite(options.reference_assigned_value)}
                  onChange={(e) =>
                    set({ reference_assigned_value: number(e.target.value) })
                  }
                />
                <datalist id="reference-presets">
                  <option value="1" />
                  <option value="10" />
                </datalist>
              </Field>
            )}
          </div>
          {options.workflow === "standard_curve" && (
            <label className="check">
              <input
                type="checkbox"
                checked={options.allow_extrapolation}
                onChange={(e) => set({ allow_extrapolation: e.target.checked })}
              />
              允许超出实测范围的外推（结果会标警告）
            </label>
          )}
          <Field label="4PL 拟合模式">
            <select
              value={options.fit_mode}
              onChange={(e) =>
                set({ fit_mode: e.target.value as AnalysisOptions["fit_mode"] })
              }
            >
              <option value="shared">共享上下平台 A / D（全局拟合）</option>
              <option value="independent">每组独立拟合 A / B / C / D</option>
            </select>
          </Field>
          <p className="subtle-note">
            共享平台假定各组响应上下限一致。平台明显不同，应检查独立拟合与残差。
          </p>
        </Card>
        <Card title="空白与重复孔" subtitle="显式设置，保留可审计的处理记录">
          <div className="field-grid">
            <Field label="空白校正">
              <select
                value={options.blank_mode}
                onChange={(e) =>
                  set({
                    blank_mode: e.target.value as AnalysisOptions["blank_mode"],
                  })
                }
              >
                <option value="none">不扣空白</option>
                <option value="constant">所有 OD 扣固定空白</option>
              </select>
            </Field>
            <Field label="空白 OD">
              <input
                type="number"
                step="any"
                disabled={options.blank_mode === "none"}
                value={finite(options.blank_value)}
                onChange={(e) => set({ blank_value: number(e.target.value) })}
              />
            </Field>
          </div>
          <Field label="重复孔处理">
            <select
              value={options.replicate_mode}
              onChange={(e) =>
                set({
                  replicate_mode: e.target
                    .value as AnalysisOptions["replicate_mode"],
                })
              }
            >
              <option value="individual">保留每个重复孔参与拟合</option>
              <option value="mean">按组、按剂量取均值后拟合</option>
            </select>
          </Field>
          <Field
            label="重复孔列映射（可选）"
            hint="未映射列仍为独立曲线。不会自动猜测重复孔。"
          >
            <textarea
              className="replicate-input"
              value={state.replicateText}
              placeholder={"Reference = Ref_1, Ref_2\nSample A = A_1, A_2"}
              onChange={(e) =>
                dispatch({
                  type: "input",
                  patch: { replicateText: e.target.value },
                })
              }
            />
          </Field>
        </Card>
      </div>
    </div>
  );
}
function number(value: string) {
  return value === "" ? Number.NaN : Number(value);
}
function finite(value: number) {
  return Number.isFinite(value) ? value : "";
}
