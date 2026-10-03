import { invoke, isTauri } from "@tauri-apps/api/core";

/** Scientific computation remains in Python. A browser without the native engine never fabricates results. */
export async function callBridge<T>(
  payload: Record<string, unknown>,
): Promise<T> {
  if (isTauri()) return invoke<T>("run_bridge", { request: payload });
  if (import.meta.env.DEV && import.meta.env.VITE_ELISA_DEV_BRIDGE === "1") {
    const response = await fetch("/api/bridge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok)
      throw new Error(`本地计算服务不可用 (${response.status})`);
    return response.json() as Promise<T>;
  }
  throw new Error(
    "当前是浏览器预览，未连接 Python 计算引擎。请使用桌面版进行解析和计算；输入仍保留在此窗口。",
  );
}
