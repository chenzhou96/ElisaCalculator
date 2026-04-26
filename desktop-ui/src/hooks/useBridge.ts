import { invoke } from '@tauri-apps/api/core'

export async function callBridge<T>(payload: Record<string, unknown>): Promise<T> {
  console.warn('[bridge] 发送请求:', JSON.stringify(payload).slice(0, 200))
  try {
    const result = await invoke<T>('run_bridge', { request: payload })
    console.warn('[bridge] 收到响应:', JSON.stringify(result).slice(0, 200))
    return result
  } catch (e) {
    console.error('[bridge] invoke 调用失败:', e)
    throw e
  }
}
