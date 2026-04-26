import { invoke } from '@tauri-apps/api/core'

export async function callBridge<T>(payload: Record<string, unknown>): Promise<T> {
  return invoke<T>('run_bridge', { request: payload })
}
