import { useState, type InputHTMLAttributes } from "react";
import { evaluateList, evaluateNumber } from "./arithmetic";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  value: number | string | null;
  onValueChange?: (value: number | null) => void;
  onTextChange?: (value: string) => void;
  optional?: boolean;
  replicates?: boolean;
};

export default function NumericInput({value, onValueChange, onTextChange, optional, replicates, ...props}: Props) {
  const display = value == null || (typeof value === "number" && !Number.isFinite(value)) ? "" : String(value);
  const [draft, setDraft] = useState(display);
  const [editing, setEditing] = useState(false);
  const text = editing ? draft : display;
  let error = "";
  let numbers: number[] = [];
  try {if (text.trim()) numbers = replicates ? evaluateList(text) : [evaluateNumber(text)];}
  catch (e) {error = e instanceof Error ? e.message : String(e);}
  function update(text: string) {
    setDraft(text);
    onTextChange?.(text);
    if (onValueChange) {
      try {onValueChange(text.trim() ? evaluateNumber(text) : optional ? null : NaN);}
      catch {onValueChange(NaN);}
    }
  }
  function commit() {
    if (!error && numbers.length && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text.trim())) {
      const normalized = numbers.map(String).join("; ");
      update(normalized);
    }
    // Invalid expressions remain visible until corrected, including on blur.
    if (!error) setEditing(false);
  }
  return <>
    <input {...props} type="text" value={text} aria-invalid={error ? true : props["aria-invalid"]}
      title={error || props.title || "支持四则运算，例如 =1/20；按 Enter 或离开输入框计算"}
      onFocus={e => {if (!editing) setDraft(display); setEditing(true); props.onFocus?.(e);}}
      onChange={e => update(e.target.value)} onBlur={e => {commit(); props.onBlur?.(e);}}
      onKeyDown={e => {if (e.key === "Enter") {e.preventDefault(); commit(); e.currentTarget.blur();} props.onKeyDown?.(e);}} />
    {error && <small className="numeric-error" role="alert">{error}</small>}
  </>;
}
