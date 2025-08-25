import { create } from 'zustand'
import type { Mesh } from "@meshtastic/protobufs"

export type TextItem = { id: string; from?: number; to?: number; channel?: number; text: string; rxRssi?: number; rxSnr?: number; at: number }
export type PositionItem = { id: string; from?: number; lat?: number; lon?: number; alt?: number; sats?: number; speed?: number; heading?: number; dop?: number; at: number }
export type TelemetryItem = { id: string; from?: number; voltage?: number; batteryLevel?: number; uptimeSec?: number; airUtilTx?: number; at: number }
export type NodeInfoItem = { id: string; num?: number; name?: string; shortName?: string; hwModel?: string; lastHeard?: number; at: number }
export type LogItem = { id: string; level: string; message: string; at: number }

type State = {
  connected: boolean
  fw?: string
  myNode?: Mesh.MyNodeInfo
  texts: TextItem[]
  positions: PositionItem[]
  telemetry: TelemetryItem[]
  nodes: NodeInfoItem[]
  logs: LogItem[]
  pushText: (i: TextItem) => void
  pushPos: (i: PositionItem) => void
  pushTel: (i: TelemetryItem) => void
  pushNode: (i: NodeInfoItem) => void
  pushLog: (i: LogItem) => void
  setConnected: (v: boolean) => void
  setMyNode: (v: Mesh.MyNodeInfo | undefined) => void
  seeNode: (num: number, patch?: Partial<NodeInfoItem>) => void
  clearAll: () => void
}

export const useStore = create<State>((set, get) => ({
  connected: false,
  texts: [], positions: [], telemetry: [], nodes: [], logs: [],
  pushText: (i) => set((s) => ({ texts: [i, ...s.texts].slice(0, 200) })),
  pushPos:  (i) => set((s) => ({ positions: [i, ...s.positions].slice(0, 200) })),
  pushTel:  (i) => set((s) => ({ telemetry: [i, ...s.telemetry].slice(0, 200) })),
  pushNode: (i) => set((s) => {
    const arr = s.nodes.slice()
    const key = i.num
    if (key != null) {
      const idx = arr.findIndex(n => n.num === key)
      if (idx >= 0) {
        const prev = arr[idx]
        const merged: NodeInfoItem = { ...prev, ...i, lastHeard: i.lastHeard ?? prev.lastHeard, at: i.at || Date.now() }
        arr.splice(idx, 1)
        arr.unshift(merged)
      } else {
        arr.unshift(i)
      }
    } else {
      arr.unshift(i)
    }
    arr.sort((a,b) => (b.lastHeard ?? b.at ?? 0) - (a.lastHeard ?? a.at ?? 0))
    return { nodes: arr.slice(0, 200) }
  }),
  pushLog:  (i) => set((s) => ({ logs: [i, ...s.logs].slice(0, 500) })),
  setConnected: (v) => set({ connected: v }),
  setMyNode: (v) => set({ myNode: v }),
  seeNode: (num, patch) => set((s) => {
    const arr = s.nodes.slice()
    const idx = arr.findIndex(n => n.num === num)
    const at = Date.now()
    if (idx >= 0) {
      const prev = arr[idx]
      const merged = { ...prev, ...patch, num, lastHeard: patch?.lastHeard ?? prev.lastHeard ?? at, at }
      arr.splice(idx,1); arr.unshift(merged)
    } else {
      arr.unshift({ id: `num-${num.toString(16)}`, num, lastHeard: patch?.lastHeard ?? at, at })
    }
    arr.sort((a,b)=> (b.lastHeard ?? b.at ?? 0) - (a.lastHeard ?? a.at ?? 0))
    return { nodes: arr.slice(0,200) }
  }),
  clearAll: () => set({ texts: [], positions: [], telemetry: [], nodes: [], logs: [] })
}))