// TBV: scroll mode as one long page. Not part of upstream foliate-js.
//
// The paginator shows one chapter (section) at a time, so in scroll mode
// reading stopped at each chapter's end. This renderer stacks chapters one
// after another in a single scrolling column, the way Kindle and Apple Books
// scroll: the next chapter is laid out as the reader nears it, and chapters
// far behind or far ahead are let go so a long book stays light. Paged mode
// still uses the paginator.
import { View, getVisibleRange, uncollapse, getBackground, debounce, setSelectionTo } from './paginator.js'

// Laid out ahead of the screen, in screen heights, before the reader gets there.
const AHEAD = 1.5
// Chapters further than this from the screen, in screen heights, are let go.
const KEEP = 3
// Scrolling or touching within this long counts as the reader moving the page.
const ACTIVE_MS = 800

export class Scroller extends HTMLElement {
    static observedAttributes = ['gap', 'margin', 'max-inline-size']
    #root = this.attachShadow({ mode: 'closed' })
    #observer = new ResizeObserver(() => requestAnimationFrame(() => this.#render()))
    #background
    #container
    #end
    // { index, view, height } for each chapter laid out, in reading order
    #entries = []
    // the chapter at the top of the screen
    #cur = null
    // what stays in place when chapters reflow: a fraction, Range or Element
    #anchor = 0
    #anchorEntry = null
    // where the page was last scrolled to by this renderer, not the reader
    #expected = null
    #anchoredAt = null
    #lastInput = 0
    #touching = false
    #locked = false
    #filling = false
    #gen = 0
    #failed = new Set()
    #margin = 0
    #styles
    #styleMap = new WeakMap()
    constructor() {
        super()
        this.#root.innerHTML = `<style>
        :host {
            display: block;
            position: relative;
            box-sizing: border-box;
            width: 100%;
            height: 100%;
            overflow: hidden;
        }
        #background, #container {
            position: absolute;
            inset: 0;
        }
        #container {
            overflow-x: hidden;
            overflow-y: auto;
            /* the place is kept by hand, as WebKit has no scroll anchoring */
            overflow-anchor: none;
        }
        </style>
        <div id="background" part="filter"></div>
        <div id="container"><div id="end"></div></div>
        `
        this.#background = this.#root.getElementById('background')
        this.#container = this.#root.getElementById('container')
        this.#end = this.#root.getElementById('end')
        this.#observer.observe(this.#container)

        const settle = debounce(() => {
            const at = this.#container.scrollTop
            if (this.#anchoredAt != null && Math.abs(at - this.#anchoredAt) < 1) this.#anchoredAt = null
            else {
                this.#anchoredAt = null
                this.#afterScroll('scroll')
            }
            this.#trim()
            this.#fill()
        }, 150)
        this.#container.addEventListener('scroll', () => {
            const at = this.#container.scrollTop
            if (this.#expected == null || Math.abs(at - this.#expected) > 1)
                this.#lastInput = performance.now()
            this.#expected = null
            this.#cur = this.#find()
            this.dispatchEvent(new Event('scroll'))
            this.#fill()
            settle()
        })
        this.#watchInput(this)
    }
    attributeChangedCallback() {
        this.#render()
    }
    get scrolled() {
        return true
    }
    get styles() {
        return this.#styles
    }
    open(book) {
        this.bookDir = book.dir
        this.sections = book.sections
        book.transformTarget?.addEventListener('data', ({ detail }) => {
            if (detail.type !== 'text/css') return
            const w = innerWidth
            const h = innerHeight
            detail.data = Promise.resolve(detail.data).then(data => data
                .replace(/(?<=[{\s;])-epub-/gi, '')
                // each chapter's frame is as tall as the chapter, so vh would be huge
                .replace(/(\d*\.?\d+)vw/gi, (_, d) => parseFloat(d) * w / 100 + 'px')
                .replace(/(\d*\.?\d+)vh/gi, (_, d) => parseFloat(d) * h / 100 + 'px'))
        })
    }
    #watchInput(target) {
        const mark = () => this.#lastInput = performance.now()
        const opts = { passive: true }
        target.addEventListener('wheel', mark, opts)
        target.addEventListener('keydown', mark, opts)
        target.addEventListener('touchstart', () => (this.#touching = true, mark()), opts)
        target.addEventListener('touchmove', mark, opts)
        target.addEventListener('touchend', () => (this.#touching = false, mark()), opts)
        target.addEventListener('touchcancel', () => (this.#touching = false, mark()), opts)
    }
    #userActive() {
        return this.#touching || performance.now() - this.#lastInput < ACTIVE_MS
    }
    #layout() {
        const { clientWidth: width, clientHeight: height } = this.#container
        const g = parseFloat(this.getAttribute('gap') ?? '7') / 100
        const margin = parseFloat(this.getAttribute('margin') ?? '48')
        const columnWidth = parseFloat(this.getAttribute('max-inline-size') ?? '720')
        this.#margin = margin
        // the same spacing sum as the paginator's, so the text sits alike in both modes
        const gap = -g / (g - 1) * width
        return { flow: 'scrolled', width, height, margin, gap, columnWidth }
    }
    #render() {
        if (!this.#entries.length) return
        const layout = this.#layout()
        for (const { view } of this.#entries) view.render(layout)
        this.#reanchor()
    }
    #setScroll(top) {
        const c = this.#container
        const max = c.scrollHeight - c.clientHeight
        const value = Math.max(0, Math.min(max, top))
        this.#expected = value
        c.scrollTop = value
        return value
    }
    #shiftBy(d) {
        if (d) this.#setScroll(this.#container.scrollTop + d)
    }
    // the chapter whose text is at the top of the screen
    #find() {
        const top = this.#container.scrollTop + 1
        for (const e of this.#entries)
            if (e.view.element.offsetTop + e.height - this.#margin > top) return e
        return this.#entries.at(-1) ?? null
    }
    #adjacent(index, dir) {
        for (let i = index + dir; i >= 0 && i < this.sections.length; i += dir)
            if (this.sections[i]?.linear !== 'no' && !this.#failed.has(i)) return i
    }
    // the last chapter can be scrolled to the top of the screen, like the others
    #sizeEnd() {
        const last = this.#entries.at(-1)
        const atBookEnd = last && this.#adjacent(last.index, 1) == null
        const room = atBookEnd ? Math.max(0, this.#container.clientHeight - last.height) : 0
        this.#end.style.height = `${room}px`
    }
    async #load(index, place) {
        const gen = this.#gen
        let src
        try {
            src = await this.sections[index].load()
        } catch (e) {
            console.warn(e)
            console.warn(new Error(`Failed to load section ${index}`))
        }
        if (gen !== this.#gen) return null
        if (typeof src !== 'string') {
            this.#failed.add(index)
            return null
        }
        const entry = { index, view: null, height: 0 }
        const view = new View({ container: this, onExpand: () => this.#onExpand(entry) })
        entry.view = view
        view.element.style.height = '0px'
        if (place === 'before') {
            this.#container.prepend(view.element)
            this.#entries.unshift(entry)
        } else {
            this.#end.before(view.element)
            this.#entries.push(entry)
        }
        this.#cur ??= entry
        await view.load(src,
            doc => this.#afterLoad(doc, index),
            ({ background }) => {
                if (entry === this.#cur || this.#entries.length === 1)
                    this.#background.style.background = background
                return this.#layout()
            })
        if (gen !== this.#gen || !view.document) return null
        this.dispatchEvent(new CustomEvent('create-overlayer', {
            detail: { doc: view.document, index, attach: overlayer => view.overlayer = overlayer },
        }))
        return entry
    }
    #afterLoad(doc, index) {
        if (doc.head) {
            const $styleBefore = doc.createElement('style')
            doc.head.prepend($styleBefore)
            const $style = doc.createElement('style')
            doc.head.append($style)
            this.#styleMap.set(doc, [$styleBefore, $style])
            this.#applyStyles(doc)
        }
        this.#watchInput(doc)
        this.dispatchEvent(new CustomEvent('load', { detail: { doc, index } }))
    }
    #onExpand(entry) {
        const height = entry.view.element.offsetHeight
        const d = height - entry.height
        entry.height = height
        this.#sizeEnd()
        if (!d) return
        const cur = this.#cur
        if (!cur || entry === cur) {
            if (entry === this.#anchorEntry && !this.#userActive()) this.#reanchor()
            return
        }
        // a chapter above the one being read changed size: keep the text still
        if (this.#entries.indexOf(entry) < this.#entries.indexOf(cur)) this.#shiftBy(d)
    }
    #reanchor() {
        if (this.#anchorEntry && this.#entries.includes(this.#anchorEntry))
            this.#scrollToAnchor(this.#anchor, 'anchor', this.#anchorEntry)
    }
    #remove(entry) {
        const i = this.#entries.indexOf(entry)
        if (i < 0) return
        this.#entries.splice(i, 1)
        entry.view.destroy()
        entry.view.element.remove()
        this.sections[entry.index]?.unload?.()
        if (this.#anchorEntry === entry) this.#anchorEntry = null
    }
    #reset() {
        this.#gen++
        for (const entry of [...this.#entries]) this.#remove(entry)
        this.#cur = null
        this.#anchorEntry = null
        this.#sizeEnd()
    }
    // lay out the chapters just ahead of (and just behind) the screen
    async #fill() {
        if (this.#filling || !this.#entries.length) return
        this.#filling = true
        const gen = this.#gen
        try {
            for (let i = 0; i < 8 && gen === this.#gen && this.#entries.length; i++) {
                const c = this.#container
                const h = c.clientHeight
                const first = this.#entries[0]
                const last = this.#entries.at(-1)
                const below = last.view.element.offsetTop + last.height - (c.scrollTop + h)
                const above = c.scrollTop - first.view.element.offsetTop
                const next = this.#adjacent(last.index, 1)
                const prev = this.#adjacent(first.index, -1)
                if (next != null && below < h * AHEAD) await this.#load(next, 'after')
                else if (prev != null && above < h * AHEAD) await this.#load(prev, 'before')
                else break
            }
        } finally {
            this.#filling = false
        }
    }
    // let go of chapters well away from the screen, from either end
    #trimLater
    #trim() {
        clearTimeout(this.#trimLater)
        // not mid-scroll, which the page moving would interrupt; tried again after
        if (this.#userActive()) {
            this.#trimLater = setTimeout(() => this.#trim(), ACTIVE_MS)
            return
        }
        const c = this.#container
        const h = c.clientHeight
        const near = e => Math.abs(this.#entries.indexOf(e) - this.#entries.indexOf(this.#cur)) <= 1
        for (;;) {
            const first = this.#entries[0]
            if (!first || near(first)) break
            if (first.view.element.offsetTop + first.height >= c.scrollTop - h * KEEP) break
            // worked out first: the page gets shorter, which can pull it up by itself
            const top = c.scrollTop - first.height
            this.#remove(first)
            this.#setScroll(top)
        }
        for (;;) {
            const last = this.#entries.at(-1)
            if (!last || near(last)) break
            if (last.view.element.offsetTop <= c.scrollTop + h * (KEEP + 1)) break
            this.#remove(last)
        }
        this.#sizeEnd()
    }
    #afterScroll(reason) {
        const entry = this.#cur
        const doc = entry?.view.document
        if (!doc?.body) return
        const c = this.#container
        const top = entry.view.element.offsetTop
        const start = Math.max(0, c.scrollTop - top - this.#margin)
        const end = c.scrollTop + c.clientHeight - top - this.#margin
        const range = getVisibleRange(doc, start, end, ({ top, bottom }) => ({ left: top, right: bottom }))
        if (reason !== 'selection' && reason !== 'navigation' && reason !== 'anchor') {
            this.#anchor = range
            this.#anchorEntry = entry
        }
        const fraction = entry.height ? Math.min(1, Math.max(0, (c.scrollTop - top) / entry.height)) : 0
        this.#background.style.background = getBackground(doc)
        this.dispatchEvent(new CustomEvent('relocate', {
            detail: { reason, range, index: entry.index, fraction },
        }))
    }
    #scrollToAnchor(anchor, reason = 'anchor', inEntry) {
        let entry
        let top
        if (typeof anchor === 'number') {
            entry = inEntry ?? this.#cur
            if (!entry) return
            top = entry.view.element.offsetTop + anchor * entry.height
        } else {
            const target = uncollapse(anchor)
            const node = target?.startContainer ?? target
            const doc = node?.nodeType === 9 ? node : node?.ownerDocument
            entry = this.#entries.find(e => e.view.document === doc)
            if (!entry) return
            const rects = target.getClientRects?.()
            const rect = Array.from(rects ?? []).find(r => r.width > 0 && r.height > 0) || rects?.[0]
            if (!rect) return
            // the chapter's text starts a margin below the top of its box,
            // and the anchor is shown that same margin below the top of the screen
            top = entry.view.element.offsetTop + rect.top
        }
        this.#anchor = anchor
        this.#anchorEntry = entry
        this.#anchoredAt = this.#setScroll(top)
        this.#cur = entry
        this.#afterScroll(reason)
    }
    async scrollToAnchor(anchor, select) {
        return this.#scrollToAnchor(anchor, select ? 'selection' : 'navigation')
    }
    async goTo(target) {
        if (this.#locked) return
        const { index, anchor, select } = await target
        if (!(index >= 0 && index < this.sections.length)) return
        this.#locked = true
        let entry
        try {
            entry = this.#entries.find(e => e.index === index)
            if (!entry) {
                this.#reset()
                this.#failed.delete(index)
                entry = await this.#load(index, 'after')
                if (!entry) return
            }
            const resolved = (typeof anchor === 'function' ? anchor(entry.view.document) : anchor) ?? 0
            this.#scrollToAnchor(resolved, select ? 'selection' : 'navigation', entry)
            if (select && typeof resolved !== 'number') setSelectionTo(resolved, 0)
        } finally {
            this.#locked = false
        }
        await this.#fill()
        // a short chapter couldn't reach the top until the next one was laid out
        if (this.#anchorEntry === entry && !this.#userActive()) this.#reanchor()
    }
    #scrollBy(distance) {
        const c = this.#container
        const smooth = this.hasAttribute('animated')
        c.scrollBy({ top: distance, behavior: smooth ? 'smooth' : 'instant' })
        this.#lastInput = performance.now()
    }
    async prev(distance) {
        this.#scrollBy(-(distance ?? this.#container.clientHeight - this.#margin * 2))
    }
    async next(distance) {
        this.#scrollBy(distance ?? this.#container.clientHeight - this.#margin * 2)
    }
    // the arrow keys
    scrollStep(direction) {
        this.#scrollBy(direction * Math.round(this.#container.clientHeight / 10))
    }
    prevSection() {
        const index = this.#cur ? this.#adjacent(this.#cur.index, -1) : null
        if (index != null) return this.goTo({ index })
    }
    nextSection() {
        const index = this.#cur ? this.#adjacent(this.#cur.index, 1) : null
        if (index != null) return this.goTo({ index })
    }
    firstSection() {
        const index = this.sections.findIndex(section => section.linear !== 'no')
        return this.goTo({ index })
    }
    lastSection() {
        const index = this.sections.findLastIndex(section => section.linear !== 'no')
        return this.goTo({ index })
    }
    // the chapter at the top of the screen comes first
    getContents() {
        const cur = this.#cur
        const ordered = cur ? [cur, ...this.#entries.filter(e => e !== cur)] : this.#entries
        return ordered.filter(e => e.view.document).map(e => ({
            index: e.index,
            overlayer: e.view.overlayer,
            doc: e.view.document,
        }))
    }
    #applyStyles(doc) {
        const $$styles = this.#styleMap.get(doc)
        const styles = this.#styles
        if (!$$styles || styles == null) return
        const [$beforeStyle, $style] = $$styles
        if (Array.isArray(styles)) {
            const [beforeStyle, style] = styles
            $beforeStyle.textContent = beforeStyle
            $style.textContent = style
        } else $style.textContent = styles
    }
    setStyles(styles) {
        this.#styles = styles
        for (const { view } of this.#entries) {
            const doc = view.document
            if (!doc) continue
            this.#applyStyles(doc)
            doc.fonts?.ready?.then(() => view.expand())
        }
        requestAnimationFrame(() => {
            const doc = this.#cur?.view.document
            if (doc?.body) this.#background.style.background = getBackground(doc)
        })
    }
    focusView() {
        this.#cur?.view.document?.defaultView?.focus()
    }
    destroy() {
        clearTimeout(this.#trimLater)
        this.#observer.unobserve(this.#container)
        this.#reset()
    }
}

customElements.define('foliate-scroller', Scroller)
