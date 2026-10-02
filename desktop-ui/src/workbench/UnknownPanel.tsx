import { useState, type Dispatch } from "react";
import type { Action, Workspace } from "./model";
import type { UnknownInput } from "./types";
import { Card, Pager } from "./Primitives";

export default function UnknownPanel({
  state,
  dispatch,
}: {
  state: Workspace;
  dispatch: Dispatch<Action>;
}) {
  const [page, setPage] = useState(0);
  const size = 6;
  const safePage = Math.min(
    page,
    Math.max(0, Math.ceil(state.unknowns.length / size) - 1),
  );
  function update(id: string, patch: Partial<UnknownInput>) {
    dispatch({
      type: "input",
      patch: {
        unknowns: state.unknowns.map((sample) =>
          sample.id === id ? { ...sample, ...patch } : sample,
        ),
      },
    });
  }
  function add() {
    const next = [
      ...state.unknowns,
      {
        id: crypto.randomUUID(),
        sample: `样品 ${state.unknowns.length + 1}`,
        od: "",
        dilution: "1",
      },
    ];
    dispatch({ type: "input", patch: { unknowns: next } });
    setPage(Math.floor((next.length - 1) / size));
  }
  return (
    <div className="unknown-layout">
      <Card
        title="未知样品"
        subtitle="输入原始 OD；重复孔使用分号分隔。统一扣除设置的空白后反算"
        action={<button onClick={add}>＋ 添加样品</button>}
      >
        <div className="table-scroll">
          <table className="unknown-table">
            <thead>
              <tr>
                <th>样品名称</th>
                <th>OD / 重复孔</th>
                <th>稀释校正倍数</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {state.unknowns
                .slice(safePage * size, safePage * size + size)
                .map((sample, index) => (
                  <tr key={sample.id}>
                    <td>
                      <input
                        aria-label={`样品名称 ${safePage * size + index + 1}`}
                        value={sample.sample}
                        onChange={(e) =>
                          update(sample.id, { sample: e.target.value })
                        }
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`样品 OD ${safePage * size + index + 1}`}
                        placeholder="例如 0.82; 0.86"
                        value={sample.od}
                        onChange={(e) =>
                          update(sample.id, { od: e.target.value })
                        }
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`样品稀释倍数 ${safePage * size + index + 1}`}
                        type="number"
                        min="1"
                        step="any"
                        value={sample.dilution}
                        onChange={(e) =>
                          update(sample.id, { dilution: e.target.value })
                        }
                      />
                    </td>
                    <td>
                      <button
                        className="icon-button"
                        aria-label={`删除样品 ${safePage * size + index + 1}`}
                        onClick={() =>
                          dispatch({
                            type: "input",
                            patch: {
                              unknowns: state.unknowns.filter(
                                (row) => row.id !== sample.id,
                              ),
                            },
                          })
                        }
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <Pager
          page={safePage}
          count={state.unknowns.length}
          size={size}
          onChange={setPage}
        />
      </Card>
      <div className="info-grid">
        <div className="info-block">
          <span className="eyebrow">计算顺序</span>
          <h3>从孔内浓度，回到原样</h3>
          <p>OD 均值 − 空白 → 标准曲线反算 → 孔内浓度 × 稀释校正倍数</p>
          <code>原样浓度 = 反算浓度 × DF</code>
        </div>
        <div className="info-block">
          <span className="eyebrow">范围保护</span>
          <h3>不把超范围当成精确结果</h3>
          <p>
            默认拒绝超出实测校准范围的结果。超出模型平台的 OD
            无法反算；不会给出伪浓度。
          </p>
          <p className="muted">例：孔内 12 ng/mL × 5 倍稀释 = 原样 60 ng/mL</p>
        </div>
      </div>
    </div>
  );
}
