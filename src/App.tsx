import React from 'react'
import { connectSerial } from './lib/meshtastic'
import { useStore } from './store'

const Logs: React.FC = () => {
  const logs = useStore(s=>s.logs)
  return <ul className="list">{logs.map(l=>(
    <li key={l.id} className="item"><span className="badge">{l.level}</span> {new Date(l.at).toLocaleString()} — {l.message}</li>
  ))}</ul>
}

const TextMessages: React.FC = () => {
  const items = useStore(s=>s.texts)
  return <ul className="list">{items.map(t=>(
    <li key={t.id} className="item">
      <div>from <b>{t.from!=null? '0x'+t.from.toString(16):'?'}</b> → {t.to!=null?'0x'+t.to.toString(16):'—'} ch {t.channel ?? '—'}</div>
      <div className="muted">{new Date(t.at).toLocaleString()}</div>
      <div style={{marginTop:6, whiteSpace:'pre-wrap', wordBreak:'break-word'}}>{t.text}</div>
      <div className="muted">RSSI {t.rxRssi ?? '—'} / SNR {t.rxSnr ?? '—'}</div>
    </li>
  ))}</ul>
}

const NodeList: React.FC = () => {
  const items = useStore(s=>s.nodes)
  const [q, setQ] = React.useState('')
  const [sortBy, setSortBy] = React.useState<'last'|'name'|'rssi'>('last')

  const filtered = React.useMemo(()=>{
    const term = q.trim().toLowerCase()
    let arr = items.slice()
    if (term) {
      arr = arr.filter(n =>
        (n.name||'').toLowerCase().includes(term) ||
        (n.shortName||'').toLowerCase().includes(term) ||
        (n.hwModel||'').toLowerCase().includes(term) ||
        (n.num!=null && ('0x'+n.num.toString(16)).includes(term))
      )
    }
    if (sortBy === 'name') {
      arr.sort((a,b)=>(a.shortName||a.name||'').localeCompare(b.shortName||b.name||''))
    } else if (sortBy === 'rssi') {
      arr.sort((a,b)=> (b.lastHeard??0)-(a.lastHeard??0))
    } else {
      arr.sort((a,b)=> (b.lastHeard??b.at??0) - (a.lastHeard??a.at??0))
    }
    return arr
  }, [items, q, sortBy])

  const now = Date.now()
  function statusColor(n: typeof items[number]){
    const lh = n.lastHeard ?? 0
    const dt = now - lh
    if (!lh) return '#999'
    if (dt < 5*60*1000) return '#16a34a'
    if (dt < 30*60*1000) return '#f59e0b'
    return '#6b7280'
  }
  function rel(t?: number){
    if (!t) return '—'
    const s = Math.max(0, Math.floor((Date.now()-t)/1000))
    if (s < 60) return `${s}s ago`
    const m = Math.floor(s/60)
    if (m < 60) return `${m}m ago`
    const h = Math.floor(m/60)
    if (h < 48) return `${h}h ago`
    const d = Math.floor(h/24)
    return `${d}d ago`
  }

  return (
    <div className="vstack" style={{gap:12}}>
      <div className="hstack" style={{gap:8, alignItems:'center'}}>
        <input placeholder="搜尋名稱 / 0xID / 型號…" value={q} onChange={e=>setQ(e.target.value)} style={{flex:1, padding:'6px 10px'}}/>
        <select value={sortBy} onChange={e=>setSortBy(e.target.value as any)} style={{padding:'6px 10px'}}>
          <option value="last">最近聽到</option>
          <option value="name">名稱</option>
          <option value="rssi">訊號（暫代）</option>
        </select>
      </div>
      <ul className="list">
        {filtered.map(n=>(
          <li className="item" key={n.num ?? n.id}>
            <div className="hstack" style={{justifyContent:'space-between', gap:12}}>
              <div className="hstack" style={{gap:10, alignItems:'center'}}>
                <span style={{display:'inline-block', width:10, height:10, borderRadius:10, background: statusColor(n)}}/>
                <div className="vstack">
                  <div className="hstack" style={{gap:8, alignItems:'baseline'}}>
                    <span className="badge">0x{(n.num??0).toString(16)}</span>
                    <strong>{n.shortName || n.name || '未知'}</strong>
                  </div>
                  <div className="muted">HW: {n.hwModel || '—'}</div>
                </div>
              </div>
              <div className="vstack" style={{textAlign:'right'}}>
                <div className="muted">Last heard</div>
                <div>{n.lastHeard? new Date(n.lastHeard).toLocaleString() : '—'} <span className="muted">({rel(n.lastHeard)})</span></div>
              </div>
            </div>
          </li>
        ))}
        {filtered.length===0 && <li className="item muted">沒有符合搜尋的節點</li>}
      </ul>
    </div>
  )
}

export default function App(){
  const connected = useStore(s=>s.connected)
  const [tab, setTab] = React.useState<'text'|'nodes'|'logs'>('text')

  async function onConnect(){
    try {
      await connectSerial()
    } catch (e:any) {
      useStore.getState().pushLog({ id: crypto.randomUUID(), level: "ERROR", message: "連線失敗: " + (e?.message||e), at: Date.now() })
    }
  }

  return (
    <div style={{maxWidth: 900, margin: '40px auto', padding: 16, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Noto Sans TC, sans-serif'}}>
      <h1>Meshtastic USB</h1>

      <div className="hstack" style={{gap:12, marginBottom:12}}>
        <button onClick={onConnect} disabled={connected}>Connect via USB</button>
        <span className="muted">{connected ? '已連線' : '未連線'}</span>
      </div>

      <div className="tabs">
        <button className={tab==='text'?'active':''} onClick={()=>setTab('text')}>文字訊息</button>
        <button className={tab==='nodes'?'active':''} onClick={()=>setTab('nodes')}>節點</button>
        <button className={tab==='logs'?'active':''} onClick={()=>setTab('logs')}>Logs</button>
      </div>

      {tab==='text' && <TextMessages/>}
      {tab==='nodes' && <NodeList/>}
      {tab==='logs' && <Logs/>}

      <style>{`
      .tabs{ display:flex; gap:8px; margin: 12px 0; }
      .tabs button{ padding:6px 12px; border:1px solid #ddd; background:#fafafa; cursor:pointer; }
      .tabs button.active{ background:#111; color:#fff; border-color:#111; }
      .list{ list-style:none; padding:0; margin:0; }
      .item{ border:1px solid #eee; border-radius:8px; padding:10px 12px; margin:8px 0; background:#fff; }
      .badge{ background:#eee; border-radius:6px; padding:2px 6px; font-size:12px; }
      .muted{ color:#666; font-size:12px; }
      .hstack{ display:flex; }
      .vstack{ display:flex; flex-direction:column; }
      button{ border-radius:8px; padding:8px 12px; border:1px solid #ddd; background:#fff; cursor:pointer; }
      input, select{ border-radius:8px; border:1px solid #ddd; }
      `}</style>
    </div>
  )
}