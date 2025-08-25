import { TransportWebSerial } from "@meshtastic/transport-web-serial"
import { MeshDevice } from "@meshtastic/core"
import { Mesh } from "@meshtastic/protobufs"
import { tryDecode, findFirstPayload, intToPortName, toDegrees, isMostlyText } from "./humanize"
import { useStore } from "../store"

// === Debug helpers ===
function hexPreview(bytes?: Uint8Array, n = 64): string {
  if (!bytes) return ''
  const len = bytes.length
  const head = Array.from(bytes.slice(0, n)).map(b=>b.toString(16).padStart(2,'0')).join('')
  return `len=${len} hex:${head}${len>n?'…':''}`
}
function collectStrings(obj: any, max=16): string[] {
  const out: string[] = []; const seen = new WeakSet<any>(); const q: any[] = [obj]
  while (q.length && out.length < max) {
    const cur = q.shift(); if (!cur || typeof cur !== 'object') continue
    if (seen.has(cur)) continue; seen.add(cur)
    for (const k of Object.keys(cur)) {
      try {
        const v: any = (cur as any)[k]
        if (typeof v === 'string') { if (v && v.trim()) out.push(`${k}: ${v.substring(0,200)}`) }
        else if (v && typeof v === 'object') { q.push(v) }
        if (out.length >= max) break
      } catch {}
    }
  }
  return out
}

// === Helpers ===
function get(obj: any, path: string[]): any {
  let cur = obj
  for (const k of path) { if (cur && typeof cur === "object" && k in cur) cur = (cur as any)[k]; else return undefined }
  return cur
}
function decodeTextFromSchemas(payload?: Uint8Array): string | undefined {
  if (!payload) return undefined
  const names = ["Data","Message","User","Text","TextMessage","MessagePacket","UserPacket","DataPacket"]
  for (const nm of names) {
    try {
      const schema: any = (Mesh as any)?.[nm + "Schema"] || (Mesh as any)?.[nm]
      if (!schema) continue
      const obj: any = tryDecode<any>(schema, payload)
      if (!obj) continue
      const candidates = [obj?.text, obj?.message, obj?.content, obj?.data?.text, obj?.payloadVariant?.text, obj?.decoded?.text]
      for (const c of candidates) { if (typeof c === "string" && c.length) return c }
    } catch {}
  }
  return undefined
}
function handleGenericWithGuards(evt: any, guards: { hasText: boolean; hasPos: boolean; hasNode: boolean; hasTel: boolean }) {
  const fp = findFirstPayload(evt)
  const port = fp.portnum
  const portName = intToPortName(port as any)
  const portNum = (typeof port === 'number') ? port :
                  (typeof port === 'string' && /^PORT_\d+$/.test(port) ? parseInt(port.slice(5), 10) : undefined)
  if ((portName === 'TEXT_MESSAGE_APP' || portNum === 1) && guards.hasText) return
  if ((portName === 'POSITION_APP' || portNum === 3) && guards.hasPos) return
  if ((portName === 'NODEINFO_APP' || portNum === 4) && guards.hasNode) return
  if ((portName === 'TELEMETRY_APP' || portNum === 67) && guards.hasTel) return
  handleGeneric(evt)
}

// === Connect & subscribe ===
export async function connectSerial() {
  const transport = await TransportWebSerial.create()
  const device = new MeshDevice(transport as any)
  const store = useStore.getState()
  store.setConnected(true)

  // list events (debug)
  try {
    const names = Object.keys((device as any).events || {})
    store.pushLog({ id: crypto.randomUUID(), level: "INFO", message: "Available events: " + names.join(", "), at: Date.now() })
  } catch {}

  // helper subscribe
  function sub(name: string, handler: (p: any) => void): boolean {
    const ev: any = (device as any).events?.[name]
    if (ev && typeof ev.subscribe === "function") {
      ev.subscribe((p: any) => {
        try { handler(p) } catch (e: any) {
          store.pushLog({ id: crypto.randomUUID(), level: "ERROR", message: `Handler error in ${name}: ${e?.message || e}`, at: Date.now() })
        }
      })
      store.pushLog({ id: crypto.randomUUID(), level: "DEBUG", message: `Subscribed ${name}`, at: Date.now() })
      return true
    } else {
      store.pushLog({ id: crypto.randomUUID(), level: "DEBUG", message: `Event not present: ${name}`, at: Date.now() })
      return false
    }
  }

  const guards = { hasText: false, hasPos: false, hasNode: false, hasTel: false }
  sub("onFromRadio", (evt) => { handleGenericWithGuards(evt, guards) })

  const textNames = ["onUserPacket", "onMessagePacket", "onTextPacket"]
  const textSubs = textNames.map(n => sub(n, (p) => handleText(p)))
  if (textSubs.some(Boolean)) guards.hasText = true
  else store.pushLog({ id: crypto.randomUUID(), level: "WARN", message: "No text event found; relying on generic FromRadio decode", at: Date.now() })

  const posNames = ["onPositionPacket", "onPosition"]
  const posSubs = posNames.map(n => sub(n, (p) => handlePosition(p)))
  if (posSubs.some(Boolean)) guards.hasPos = true
  else store.pushLog({ id: crypto.randomUUID(), level: "WARN", message: "No position event found; relying on generic FromRadio decode", at: Date.now() })

  const nodeNames = ["onNodePacket", "onNodeInfoPacket", "onNodeInfo"]
  const nodeSubs = nodeNames.map(n => sub(n, (p) => handleNode(p)))
  if (nodeSubs.some(Boolean)) guards.hasNode = true

  const telNames = ["onTelemetryPacket", "onTelemetry"]
  const telSubs = telNames.map(n => sub(n, (p) => handleTelemetry(p)))
  if (telSubs.some(Boolean)) guards.hasTel = true

  ;(device as any).configure?.().catch(()=>{})
  ;(device as any).setHeartbeatInterval?.(15000)
  return device
}

// === Decoders (human readable) ===
export function handleText(pkt: any) {
  const fp = findFirstPayload(pkt)
  const payload = fp.payload
  const meta = fp.meta || {}

  let text: string | undefined =
    (typeof (pkt as any)?.text === "string" && (pkt as any).text) ||
    (typeof get(pkt, ["data","text"]) === "string" && get(pkt, ["data","text"])) ||
    (typeof get(pkt, ["packet","decoded","text"]) === "string" && get(pkt, ["packet","decoded","text"])) ||
    (typeof get(pkt, ["packet","decoded","data","text"]) === "string" && get(pkt, ["packet","decoded","data","text"])) ||
    (typeof get(pkt, ["decoded","text"]) === "string" && get(pkt, ["decoded","text"])) ||
    (typeof get(pkt, ["decoded","data","text"]) === "string" && get(pkt, ["decoded","data","text"])) ||
    decodeTextFromSchemas(payload) ||
    (typeof get(pkt, ["data"]) === "string" && get(pkt, ["data"])) ||
    (typeof get(pkt, ["packet","decoded","data"]) === "string" && get(pkt, ["packet","decoded","data"])) ||
    (typeof get(pkt, ["decoded","data"]) === "string" && get(pkt, ["decoded","data"]))

  if (!text && payload) {
    try {
      const s = new TextDecoder("utf-8").decode(payload).replace(/\u0000/g, "")
      if (isMostlyText(s)) text = s
    } catch {}
  }
  if (!text) {
    useStore.getState().pushLog({ id: crypto.randomUUID(), level: "DEBUG", message: "TEXT fallback: payload " + hexPreview(payload), at: Date.now() })
    const strs = collectStrings(pkt, 20)
    if (strs.length) useStore.getState().pushLog({ id: crypto.randomUUID(), level: "DEBUG", message: "TEXT fallback: strings→ " + strs.join(" | "), at: Date.now() })
    text = "(binary)"
  }

  useStore.getState().pushText({
    id: crypto.randomUUID(),
    from: fp.from, to: fp.to, channel: fp.channel, text,
    rxRssi: meta.rxRssi, rxSnr: meta.rxSnr,
    at: Date.now()
  })
  try { const n = Number(fp.from); if (!Number.isNaN(n)) useStore.getState().seeNode(n, { lastHeard: Date.now() }) } catch {}
}

export function handlePosition(pkt: any) {
  const fp = findFirstPayload(pkt)
  const payload = fp.payload
  const pos = tryDecode<any>((Mesh as any)?.PositionSchema || (Mesh as any)?.Position, payload) || {}
  const lat = toDegrees(pos?.latitude_i), lon = toDegrees(pos?.longitude_i), alt = pos?.altitude
  const sats = pos?.sats_in_view, speed = pos?.ground_speed, heading = pos?.ground_track, dop = pos?.pdop

  useStore.getState().pushPos({
    id: crypto.randomUUID(),
    from: fp.from, lat, lon, alt, sats, speed, heading, dop, at: Date.now()
  })
  try { const n = Number(fp.from); if (!Number.isNaN(n)) useStore.getState().seeNode(n, { lastHeard: Date.now() }) } catch {}
}

export function handleTelemetry(pkt: any) {
  const fp = findFirstPayload(pkt)
  const payload = fp.payload
  const tel = tryDecode<any>((Mesh as any)?.TelemetrySchema || (Mesh as any)?.Telemetry, payload) || {}
  const v = tel?.device_metrics?.voltage, batt = tel?.device_metrics?.battery_level
  const uptime = tel?.device_metrics?.uptime_seconds, aut = tel?.air_util_tx

  useStore.getState().pushTel({
    id: crypto.randomUUID(),
    from: fp.from,
    voltage: v, batteryLevel: batt, uptimeSec: uptime, airUtilTx: aut,
    at: Date.now()
  })
  try { const n = Number(fp.from); if (!Number.isNaN(n)) useStore.getState().seeNode(n, { lastHeard: Date.now() }) } catch {}
}

export function handleNode(pkt: any) {
  const fp = findFirstPayload(pkt)
  const payload = fp.payload
  const ni = tryDecode<any>((Mesh as any)?.NodeInfoSchema || (Mesh as any)?.NodeInfo, payload) || {}
  const num = (fp.from ?? ni?.num) as number | undefined
  const user = ni?.user || {}
  const longName = user?.long_name; const shortName = user?.short_name
  const hwModel = (Mesh as any)?.HardwareModel?.[ni?.hardware_model] || ni?.hardware_model
  const lastHeard = ni?.last_heard ? Number(ni.last_heard) * 1000 : Date.now()

  if (typeof num === "number") useStore.getState().seeNode(num, { name: longName, shortName, hwModel, lastHeard })
  useStore.getState().pushNode({
    id: crypto.randomUUID(),
    num, name: longName, shortName, hwModel, lastHeard, at: Date.now()
  })
}

export function handleGeneric(evt: any) {
  const fp = findFirstPayload(evt)
  const portName = intToPortName(fp.portnum as any)
  switch (portName) {
    case "TEXT_MESSAGE_APP": return handleText(evt)
    case "POSITION_APP": return handlePosition(evt)
    case "NODEINFO_APP": return handleNode(evt)
    case "TELEMETRY_APP": return handleTelemetry(evt)
    default:
      useStore.getState().pushLog({ id: crypto.randomUUID(), level: "DEBUG", message: `Unhandled port: ${portName}`, at: Date.now() })
  }
}