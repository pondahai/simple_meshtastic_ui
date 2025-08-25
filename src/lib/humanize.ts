import { Mesh } from "@meshtastic/protobufs"

export type Maybe<T> = T | undefined | null

export function tryDecode<T>(schema: any, bytes?: Uint8Array): Maybe<T> {
  if (!bytes || !schema) return undefined
  try {
    if (typeof schema.fromBinary === "function") return schema.fromBinary(bytes) as T
    if (schema.type && typeof schema.type.fromBinary === "function") return schema.type.fromBinary(bytes) as T
    if (typeof schema.decode === "function") return schema.decode(bytes) as T
  } catch {}
  return undefined
}

export function intToPortName(port?: number | string): string {
  const FALLBACK: Record<number, string> = {
    1: "TEXT_MESSAGE_APP",
    3: "POSITION_APP",
    4: "NODEINFO_APP",
    67: "TELEMETRY_APP",
  }
  if (typeof port === "string") {
    const m = /^PORT_(\d+)$/.exec(port)
    if (m) {
      const n = parseInt(m[1], 10)
      return FALLBACK[n] || port
    }
    return port
  }
  if (typeof port === "number") {
    try {
      const anyMesh: any = (Mesh as any)
      const enums = [anyMesh?.PortNum, (anyMesh?.Mesh || {})?.PortNum, anyMesh]
      for (const e of enums) {
        if (!e) continue
        for (const [k, v] of Object.entries(e)) {
          if (v === port && /^[A-Z_]+$/.test(k)) return k as string
        }
      }
    } catch {}
    return FALLBACK[port] || `PORT_${port}`
  }
  return "UNKNOWN"
}

export function getPath<T = any>(obj: any, path: string[]): Maybe<T> {
  let cur = obj
  for (const key of path) {
    if (cur && typeof cur === "object" && key in cur) cur = (cur as any)[key]
    else return undefined
  }
  return cur as T
}

export function findFirstPayload(obj: any): { payload?: Uint8Array, portnum?: number | string, from?: number, to?: number, channel?: number, meta?: any } {
  const queue: any[] = [obj]; const result: any = { meta: {} }; const seen = new WeakSet<any>()
  while (queue.length) {
    const cur = queue.shift()
    if (!cur || typeof cur !== "object") continue
    if (seen.has(cur)) continue; seen.add(cur)
    if ((cur as any).payload instanceof Uint8Array) result.payload = (cur as any).payload
    if (typeof (cur as any).portnum !== "undefined") result.portnum = (cur as any).portnum
    if (typeof (cur as any).from === "number") result.from = (cur as any).from
    if (typeof (cur as any).to === "number") result.to = (cur as any).to
    if (typeof (cur as any).channel === "number") result.channel = (cur as any).channel
    if (typeof (cur as any).rxSnr === "number" && result.meta) result.meta.rxSnr = (cur as any).rxSnr
    if (typeof (cur as any).rxRssi === "number" && result.meta) result.meta.rxRssi = (cur as any).rxRssi
    for (const k of Object.keys(cur)) {
      const v = (cur as any)[k]; if (v && typeof v === "object") queue.push(v)
    }
  }
  return result
}

export function toDegrees(i?: number): number | undefined {
  if (i === undefined || i === null) return undefined
  return Math.round((i * 1e-7) * 1e7) / 1e7
}

export function asPercent(n?: number): string | undefined {
  if (n === undefined || n === null) return undefined
  return `${Math.round(n * 100)}%`
}

export function isMostlyText(s: string): boolean {
  if (!s) return false
  let printable = 0, total = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i); total++
    if (c === 9 || c === 10 || c === 13) printable++
    else if (c >= 32 && c < 127) printable++
    else if (c >= 0x00A0) printable++
  }
  return (printable / Math.max(total, 1)) >= 0.8
}