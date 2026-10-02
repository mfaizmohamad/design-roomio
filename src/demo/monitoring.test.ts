import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createErrorBuffer, installErrorCapture, MAX_EVENTS_PER_PAGE, type CapturedEvent } from './errorBuffer'
import { RENDER_ERROR_EVENT } from '../errorEvents'
import { linkedinHref, mailtoHref } from './site'
import { Footer } from './DemoApp'

const ev = (message: string, kind: CapturedEvent['kind'] = 'error'): CapturedEvent => ({ kind, message })

describe('error buffer', () => {
  it('holds events until a sink attaches, then replays them in order', () => {
    const b = createErrorBuffer()
    b.record(ev('a'))
    b.record(ev('b'))
    expect(b.pendingCount).toBe(2)
    const sent: string[] = []
    b.attachSink((e) => sent.push(e.message))
    expect(sent).toEqual(['a', 'b'])
    b.record(ev('c'))
    expect(sent).toEqual(['a', 'b', 'c'])
    expect(b.pendingCount).toBe(0)
  })

  it('drops repeats of the same error — a render-loop crash fires every frame', () => {
    const b = createErrorBuffer()
    const sent: string[] = []
    b.attachSink((e) => sent.push(e.message))
    for (let i = 0; i < 600; i++) b.record(ev('Cannot read properties of undefined'))
    expect(sent).toHaveLength(1)
    // same text, different kind is a different problem
    expect(b.record(ev('Cannot read properties of undefined', 'render'))).toBe(true)
  })

  it('stops at the per-page cap of distinct events', () => {
    const b = createErrorBuffer()
    const sent: string[] = []
    b.attachSink((e) => sent.push(e.message))
    for (let i = 0; i < MAX_EVENTS_PER_PAGE + 5; i++) b.record(ev(`e${i}`))
    expect(sent).toHaveLength(MAX_EVENTS_PER_PAGE)
    expect(b.record(ev('one more'))).toBe(false)
  })

  it('caps what it buffers while the reporter is still loading', () => {
    const b = createErrorBuffer({ maxEvents: 100, maxBuffered: 3 })
    for (let i = 0; i < 10; i++) b.record(ev(`e${i}`))
    expect(b.pendingCount).toBe(3)
  })
})

describe('installErrorCapture', () => {
  // Minimal window/document stand-ins: node has EventTarget but no DOM.
  const fakeWindow = () => {
    const win = new EventTarget() as EventTarget & { document: EventTarget }
    win.document = new EventTarget()
    return win
  }
  const fire = (target: EventTarget, type: string, props: Record<string, unknown> = {}) =>
    target.dispatchEvent(Object.assign(new Event(type), props))

  it('captures errors, rejections, render errors and WebGL context loss', () => {
    const win = fakeWindow()
    const b = createErrorBuffer()
    const uninstall = installErrorCapture(b, win as unknown as Window)
    const sent: CapturedEvent[] = []
    b.attachSink((e) => sent.push(e))

    const boom = new Error('boom')
    fire(win, 'error', { message: 'boom', error: boom })
    fire(win, 'unhandledrejection', { reason: 'nope' })
    fire(win, RENDER_ERROR_EVENT, { detail: { error: new Error('render failed'), componentStack: '' } })
    fire(win.document, 'webglcontextlost')

    expect(sent.map((e) => [e.kind, e.message])).toEqual([
      ['error', 'boom'],
      ['rejection', 'nope'],
      ['render', 'render failed'],
      ['webgl-context-lost', 'WebGL context lost'],
    ])
    expect(sent[0].error).toBe(boom)

    uninstall()
    fire(win, 'error', { message: 'after uninstall' })
    expect(sent).toHaveLength(4)
  })
})

describe('footer links', () => {
  it('accepts only https LinkedIn profile or company URLs', () => {
    expect(linkedinHref('https://www.linkedin.com/in/jane-doe')).toBe('https://www.linkedin.com/in/jane-doe')
    expect(linkedinHref('https://linkedin.com/company/roomio/')).toBe('https://linkedin.com/company/roomio/')
    expect(linkedinHref('')).toBeNull()
    expect(linkedinHref('http://www.linkedin.com/in/jane')).toBeNull()
    expect(linkedinHref('javascript:alert(1)')).toBeNull()
    expect(linkedinHref('https://linkedin.com.evil.example/in/jane')).toBeNull()
    expect(linkedinHref('https://www.linkedin.com/feed/')).toBeNull()
  })

  it('builds mailto only for a plausible address', () => {
    expect(mailtoHref('hello@roomio.app')).toBe('mailto:hello@roomio.app')
    expect(mailtoHref('')).toBeNull()
    expect(mailtoHref('not an email')).toBeNull()
    expect(mailtoHref('a@b.c?subject=x')).toBeNull()
  })

  it('renders © year always, and each contact link only when configured', () => {
    const none = renderToStaticMarkup(createElement(Footer, { site: { linkedinUrl: '', contactEmail: '' }, year: 2026 }))
    expect(none).toContain('© 2026 Roomio')
    expect(none).not.toContain('<nav')

    const both = renderToStaticMarkup(createElement(Footer, {
      site: { linkedinUrl: 'https://www.linkedin.com/in/jane-doe', contactEmail: 'hello@roomio.app' },
      year: 2026,
    }))
    expect(both).toContain('href="mailto:hello@roomio.app"')
    expect(both).toContain('href="https://www.linkedin.com/in/jane-doe"')
    // a new tab must not get a handle back to this page
    expect(both).toContain('rel="noopener noreferrer"')
  })
})
