/** Numbers, parentheses and four arithmetic operators only; never execute code. */
export function evaluateNumber(input: string): number {
  const text = input.trim().replace(/^=/, "").replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-");
  if (!text || text.length > 4096) throw new Error("请输入数字或四则运算表达式");
  let position = 0, depth = 0, operations = 0;
  const space = () => {while (/\s/.test(text[position] ?? "") && position < text.length) position++;};
  const finite = (value: number) => {if (!Number.isFinite(value)) throw new Error("运算结果必须为有限数字"); return value;};
  function atom(): number {
    if (++depth > 64 || ++operations > 256) throw new Error("表达式过长或括号层数过多");
    space();
    let value: number;
    const token = text[position];
    if (token === "+" || token === "-") {position++; value = (token === "-" ? -1 : 1) * atom();}
    else if (token === "(") {position++; value = sum(); space(); if (text[position++] !== ")") throw new Error("括号不完整");}
    else {
      const match = text.slice(position).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i);
      if (!match) throw new Error("仅支持数字、括号和 + − × ÷");
      position += match[0].length; value = Number(match[0]);
    }
    depth--; return finite(value);
  }
  function product(): number {
    let value = atom();
    while (true) {
      space(); const op = text[position]; if (op !== "*" && op !== "/") return value;
      position++; const right = atom(); if (op === "/" && right === 0) throw new Error("不能除以 0");
      value = finite(op === "*" ? value * right : value / right);
    }
  }
  function sum(): number {
    let value = product();
    while (true) {
      space(); const op = text[position]; if (op !== "+" && op !== "-") return value;
      position++; const right = product(); value = finite(op === "+" ? value + right : value - right);
    }
  }
  const result = sum(); space(); if (position !== text.length) throw new Error("表达式中有不支持的内容");
  return result;
}

export function evaluateList(text: string): number[] {
  const cells = text.trim().split(/[;,，；]+/).filter(value => value.trim());
  // Whitespace-separated literal replicates remain compatible; '=' denotes one expression.
  return cells.flatMap(cell => {
    const tokens = cell.trim().split(/\s+/);
    const literals = !cell.trim().startsWith("=") && tokens.length > 1 && tokens.every(token => /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(token));
    return literals ? tokens.map(evaluateNumber) : [evaluateNumber(cell)];
  });
}
