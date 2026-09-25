import interconnect from '@system.interconnect'

const connect = interconnect.instance()
let seq = 0
const pending = {}
let timer = null
let retryTimer = null

function send(data) {
  return new Promise((resolve, reject) => {
    connect.send({ data, success: () => resolve(true), fail: (msg) => reject(msg) })
  })
}

function startHeartbeat() {
  if (timer) return
  timer = setInterval(() => send({ type: 'SF_PING', data: { ts: Date.now() } }).catch(() => {}), 10000)
}

function startRetryLoop() {
  if (retryTimer) return
  retryTimer = setInterval(() => {
    if (global.NetworkStatus === 'bridge' || global.NetworkStatus === 'connecting') return
    connect.getReadyState({
      success: (data) => {
        if (data && data.status === 1) handshake().catch(() => {})
      },
      fail: () => {}
    })
  }, 5000)
}

function onMessage(message) {
  const msg = message && message.data ? message.data : message
  if (!msg || !msg.type) return
  if (msg.type === 'SF_HANDSHAKE') {
    send({ type: 'SF_HANDSHAKE_ACK', status: 'OK', data: {} }).then(startHeartbeat)
  } else if (msg.type === 'SF_HANDSHAKE_ACK') {
    global.NetworkStatus = 'bridge'; global.fetchAva = true; startHeartbeat()
  } else if (msg.type === 'SF_PONG') {
    return
  } else if (msg.type === 'SF_CLOSE_BRIDGE') {
    send({ type: 'SF_CLOSE_BRIDGE_ACK', status: 'OK', data: {} }).catch(() => {})
    closeBridge('桥接网络已断开')
  } else if (msg.type === 'SF_RESPONSE') {
    const data = msg.data || {}; const item = pending[data.id]
    if (!item) return
    if (msg.status !== 'OK') { delete pending[data.id]; item.reject(new Error(msg.status)); return }
    if (data.totalChunks > 0) {
      item.chunks[data.chunk] = data.body || ''
      if (data.chunk === 1) { item.headers = data.headers || {}; item.code = data.statusCode || 0 }
      if (Object.keys(item.chunks).length === data.totalChunks) {
        let encoded = ''
        for (let i = 1; i <= data.totalChunks; i++) encoded += item.chunks[i] || ''
        const body = decodeBase64(encoded)
        delete pending[data.id]; item.resolve({ code: item.code, headers: item.headers, data: body })
      }
    } else {
      delete pending[data.id]; item.resolve({ code: data.statusCode || 0, headers: data.headers || {}, data: data.body || '' })
    }
  }
}

function decodeBase64(value) {
  try { return global.crypto && crypto.atob ? crypto.atob(value) : value } catch (e) { return value }
}

function closeBridge(reason) {
  global.NetworkStatus = 'none'; global.fetchAva = false
  Object.keys(pending).forEach(id => { pending[id].reject(new Error(reason)); delete pending[id] })
  if (timer) { clearInterval(timer); timer = null }
}

connect.onmessage = onMessage
connect.onopen = () => {
  global.NetworkStatus = 'connecting'
  handshake().catch(() => {})
  startRetryLoop()
}
connect.onclose = () => { closeBridge('手机连接已断开'); startRetryLoop() }
connect.onerror = () => { closeBridge('手机通信错误'); startRetryLoop() }

export function handshake() {
  startRetryLoop()
  return send({ type: 'SF_HANDSHAKE', data: {} }).then(() => { global.NetworkStatus = 'connecting' })
}

export function request(url, options = {}) {
  const id = 'sf_' + (++seq)
  return new Promise((resolve, reject) => {
    pending[id] = { resolve, reject, chunks: {} }
    send({ type: 'SF_REQUEST', data: {
      id, url: encodeURI(url), method: options.method || 'GET',
      headers: options.headers || {}, body: options.body || null,
      sse: false, timeout: options.timeout || 15000
    }}).catch(err => { delete pending[id]; reject(err) })
  })
}

export function getStatus() { return global.NetworkStatus || 'none' }
