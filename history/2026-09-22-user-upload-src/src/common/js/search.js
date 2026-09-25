import { request } from './bridge'

function stripTags(value) {
  return (value || '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim()
}

export function searchDuckDuckGo(query, page = 0) {
  const offset = page * 30
  const url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query) + '&s=' + offset + '&kl=wt-wt'
  return request(url, { headers: { 'Accept-Language': 'zh-CN,zh;q=0.9', 'User-Agent': 'Mozilla/5.0' } }).then(res => {
    if (res.code < 200 || res.code >= 400) throw new Error('搜索服务返回 HTTP ' + res.code)
    return parseDuckResults(String(res.data || ''))
  })
}

export function parseDuckResults(html) {
  const output = []; const re = /<a[^>]+href="\/url\?q=([^&"]+)[^>]*>([\s\S]*?)<\/a>/gi; let match
  while ((match = re.exec(html)) && output.length < 10) {
    const url = decodeURIComponent(match[1]); const title = stripTags(match[2])
    if (!/^https?:/i.test(url) || !title) continue
    const from = match.index + match[0].length; const summary = stripTags(html.slice(from, from + 700)).slice(0, 120)
    output.push({ title, url, summary })
  }
  if (!output.length) {
    const ddg = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi
    while ((match = ddg.exec(html)) && output.length < 10) {
      let url = match[1]; const encoded = /uddg=([^&]+)/i.exec(url)
      if (encoded) url = decodeURIComponent(encoded[1])
      const title = stripTags(match[2]); const summary = stripTags(match[3])
      if (/^https?:/i.test(url) && title) output.push({ title, url, summary: summary.slice(0, 120) })
    }
  }
  return output
}

export function readPage(url) {
  return request(url, { headers: { 'Accept-Language': 'zh-CN,zh;q=0.9' }, timeout: 20000 }).then(res => parsePage(String(res.data || ''), url))
}

export function parsePage(html, sourceUrl) {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  const title = stripTags(titleMatch ? titleMatch[1] : sourceUrl)
  const links = []; const linkRe = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi; let m
  while ((m = linkRe.exec(html)) && links.length < 80) {
    const text = stripTags(m[2]); if (!text) continue
    let href = m[1]; if (href.indexOf('//') === 0) href = 'https:' + href
    if (href.indexOf('/') === 0) { try { href = new URL(href, sourceUrl).toString() } catch (e) {} }
    if (/^https?:/i.test(href)) links.push({ text: text.slice(0, 60), url: href })
  }
  const body = html.replace(/<(script|style|svg|noscript|header|footer|nav|aside)[^>]*>[\s\S]*?<\/\1>/gi, '\n').replace(/<br\s*\/?>(?:)/gi, '\n')
  const text = stripTags(body).replace(/([。！？；])\s*/g, '$1\n').replace(/\n{2,}/g, '\n').trim()
  return { title, text: text.slice(0, 18000), links }
}
