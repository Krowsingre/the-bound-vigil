// TBV: changed from upstream foliate-js. Added here:
// - a `spread` attribute ("auto", "none" or "both") to choose one or two
//   pages at a time, and a `flow` attribute ("paginated" or "scrolled") for
//   scrolling through every page in one long column;
// - highlights and search marks (an overlayer on each page);
// - pages that stay in view when zoomed past the screen's width;
// - Ctrl+wheel and pinch zoom, reported as a `zoom-change` event, and the
//   scale in use reported as a `scale` event;
// - a page drawn again at a new size only once the newest drawing is done.

const parseViewport = str => str
    ?.split(/[,;\s]/) // NOTE: technically, only the comma is valid
    ?.filter(x => x)
    ?.map(x => x.split('=').map(x => x.trim()))

const getViewport = (doc, viewport) => {
    // use `viewBox` for SVG
    if (doc.documentElement.localName === 'svg') {
        const [, , width, height] = doc.documentElement
            .getAttribute('viewBox')?.split(/\s/) ?? []
        return { width, height }
    }

    // get `viewport` `meta` element
    const meta = parseViewport(doc.querySelector('meta[name="viewport"]')
        ?.getAttribute('content'))
    if (meta) return Object.fromEntries(meta)

    // fallback to book's viewport
    if (typeof viewport === 'string') return parseViewport(viewport)
    if (viewport?.width && viewport.height) return viewport

    // if no viewport (possibly with image directly in spine), get image size
    const img = doc.querySelector('img')
    if (img) return { width: img.naturalWidth, height: img.naturalHeight }

    // just show *something*, i guess...
    console.warn(new Error('Missing viewport properties'))
    return { width: 1000, height: 2000 }
}

// TBV: the zoom range, as a multiple of the page's own size.
export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 5
const clampZoom = z => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))

// TBV: room around the pages when scrolling, and between them.
const SCROLL_GAP = 12

export class FixedLayout extends HTMLElement {
    static observedAttributes = ['zoom', 'spread', 'flow']
    #root = this.attachShadow({ mode: 'closed' })
    #observer = new ResizeObserver(() => this.#relayout())
    #spreads
    #index = -1
    defaultViewport
    spread
    #portrait = false
    #left
    #right
    #center
    #side
    #zoom
    #spreadMode = 'auto'
    #flow = 'paginated'
    #scale = 1
    // Scrolling: one holder per page, with a frame while it's near the screen.
    #pages = []
    #sizes = new Map()
    #scrollIndex = -1
    #scrollFrame = 0
    #pinch = null
    #swipe = null
    #showing = null
    constructor() {
        super()

        const sheet = new CSSStyleSheet()
        this.#root.adoptedStyleSheets = [sheet]
        sheet.replaceSync(`:host {
            width: 100%;
            height: 100%;
            display: flex;
            justify-content: flex-start;
            align-items: center;
            overflow: auto;
        }
        :host([flow="scrolled"]) {
            display: block;
        }
        .column {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: ${SCROLL_GAP}px;
            padding: ${SCROLL_GAP}px 0;
            min-width: 100%;
            width: max-content;
            box-sizing: border-box;
        }
        .holder {
            position: relative;
            flex-shrink: 0;
            margin-inline: auto;
            box-sizing: border-box;
        }`)

        this.#observer.observe(this)
        this.#watchSharpness()
        this.addEventListener('scroll', () => this.#onScroll(), { passive: true })
        this.addEventListener('wheel', e => this.#onWheel(e), { passive: false })
    }
    attributeChangedCallback(name, old, value) {
        if (old === value) return
        switch (name) {
            case 'zoom': {
                const before = this.#zoom
                this.#zoom = value !== 'fit-width' && value !== 'fit-page'
                    ? clampZoom(parseFloat(value)) : value
                if (before !== this.#zoom) this.#relayout(true)
                break
            }
            case 'spread':
                this.#spreadMode = value === 'none' || value === 'both' ? value : 'auto'
                if (this.book && this.#flow === 'paginated') this.#rebuild()
                break
            case 'flow':
                this.#flow = value === 'scrolled' ? 'scrolled' : 'paginated'
                if (this.book) this.#rebuild()
                break
        }
    }
    // Moved to a screen of another sharpness (or the system zoom changed):
    // pages are drawn again to match it.
    #watchSharpness() {
        const query = matchMedia(`(resolution: ${devicePixelRatio}dppx)`)
        query.addEventListener('change', () => {
            this.#relayout()
            this.#watchSharpness()
        }, { once: true })
    }
    /** TBV: the scale the pages are drawn at now, 1 being their own size. */
    get scale() {
        return this.#scale
    }
    get #effectiveSpread() {
        return this.#spreadMode === 'auto' ? this.spread : this.#spreadMode
    }
    #setScale(scale) {
        if (Math.abs(scale - this.#scale) < 1e-4) return
        this.#scale = scale
        this.dispatchEvent(new CustomEvent('scale', { detail: { scale } }))
    }
    #relayout(keepPlace) {
        if (this.#flow === 'scrolled') this.#layoutScroll(keepPlace)
        else this.#render()
    }
    // TBV: listens on a page for zoom gestures, Ctrl+wheel and two fingers.
    #listen(doc) {
        doc.addEventListener('wheel', e => this.#onWheel(e), { passive: false })
        doc.addEventListener('touchstart', e => {
            if (e.touches.length === 1) {
                const [t] = e.touches
                this.#swipe = { x: t.screenX, y: t.screenY, at: Date.now() }
                return
            }
            this.#swipe = null
            if (e.touches.length !== 2) return
            const [a, b] = e.touches
            this.#pinch = { start: Math.hypot(a.screenX - b.screenX, a.screenY - b.screenY), ratio: 1 }
        }, { passive: true })
        doc.addEventListener('touchmove', e => {
            if (!this.#pinch || e.touches.length !== 2) return
            e.preventDefault()
            const [a, b] = e.touches
            const ratio = Math.hypot(a.screenX - b.screenX, a.screenY - b.screenY) / (this.#pinch.start || 1)
            this.#pinch.ratio = ratio
            // A quick stretch of what's drawn; the pages are drawn again at the end.
            Object.assign(this.style, {
                transform: `scale(${ratio})`,
                transformOrigin: 'center',
            })
        }, { passive: false })
        const end = e => {
            this.#onSwipeEnd(e)
            if (!this.#pinch || e.touches.length) return
            const { ratio } = this.#pinch
            this.#pinch = null
            this.style.transform = ''
            if (Math.abs(ratio - 1) > 0.03) this.#requestZoom(this.#scale * ratio)
        }
        doc.addEventListener('touchend', end)
        doc.addEventListener('touchcancel', end)
    }
    // A quick sideways swipe turns the page, unless the page is wider than
    // the screen (zoomed in), when it moves around the page instead.
    #onSwipeEnd(e) {
        const swipe = this.#swipe
        this.#swipe = null
        if (!swipe || this.#flow === 'scrolled' || e.type !== 'touchend') return
        const t = e.changedTouches[0]
        if (!t || Date.now() - swipe.at > 600) return
        const dx = t.screenX - swipe.x, dy = t.screenY - swipe.y
        if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 2) return
        if (this.scrollWidth > this.clientWidth + 1) return
        if (t.target?.ownerDocument?.getSelection?.()?.isCollapsed === false) return
        const forward = (dx < 0) !== !!this.rtl
        void (forward ? this.next() : this.prev())
    }
    #onWheel(e) {
        if (!e.ctrlKey && !e.metaKey) return
        e.preventDefault()
        const factor = Math.exp(-Math.max(-60, Math.min(60, e.deltaY)) / 300)
        this.#requestZoom(this.#scale * factor)
    }
    #requestZoom(scale) {
        const value = Math.round(clampZoom(scale) * 100) / 100
        this.dispatchEvent(new CustomEvent('zoom-change', { detail: { zoom: value } }))
    }
    async #createFrame({ index, src: srcOption }, parent = this.#root) {
        const srcOptionIsString = typeof srcOption === 'string'
        const src = srcOptionIsString ? srcOption : srcOption?.src
        const onZoom = srcOptionIsString ? null : srcOption?.onZoom
        const element = document.createElement('div')
        element.setAttribute('dir', 'ltr')
        element.style.position = 'relative'
        const iframe = document.createElement('iframe')
        element.append(iframe)
        Object.assign(iframe.style, {
            border: '0',
            display: 'none',
            overflow: 'hidden',
        })
        // `allow-scripts` is needed for events because of WebKit bug
        // https://bugs.webkit.org/show_bug.cgi?id=218086
        iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts')
        iframe.setAttribute('scrolling', 'no')
        iframe.setAttribute('part', 'filter')
        parent.append(element)
        if (!src) return { blank: true, element, iframe, index }
        return new Promise(resolve => {
            iframe.addEventListener('load', () => {
                const doc = iframe.contentDocument
                this.#listen(doc)
                this.dispatchEvent(new CustomEvent('load', { detail: { doc, index } }))
                const { width, height } = getViewport(doc, this.defaultViewport)
                resolve({
                    element, iframe, index,
                    width: parseFloat(width),
                    height: parseFloat(height),
                    onZoom,
                })
            }, { once: true })
            iframe.src = src
        })
    }
    // TBV: sizes a page's frame for a scale, draws it again if it draws
    // itself (PDF pages do), then lays highlights over it.
    #transformFrame(frame, scale, blankWidth, blankHeight) {
        const { element, iframe, width, height, blank, onZoom } = frame
        if (!iframe) return
        const iframeScale = onZoom ? scale : 1
        Object.assign(iframe.style, {
            width: `${width * iframeScale}px`,
            height: `${height * iframeScale}px`,
            transform: onZoom ? 'none' : `scale(${scale})`,
            transformOrigin: 'top left',
            display: blank ? 'none' : 'block',
        })
        Object.assign(element.style, {
            width: `${(width ?? blankWidth) * scale}px`,
            height: `${(height ?? blankHeight) * scale}px`,
            overflow: 'hidden',
            display: 'block',
            flexShrink: '0',
            marginBlock: 'auto',
        })
        if (blank) return
        if (onZoom) {
            // Drawn again only for a new size or a screen of another sharpness.
            const key = `${scale}@${devicePixelRatio}`
            if (frame.drawnAt === key) return
            frame.drawnAt = key
            frame.drawing = Promise.resolve(onZoom({ doc: iframe.contentDocument, scale }))
                .then(drawn => {
                    if (drawn !== false && frame.drawnAt === key) this.#overlay(frame, scale)
                })
                .catch(e => console.error(e))
        } else this.#overlay(frame, scale)
    }
    #overlay(frame, scale) {
        const doc = frame.iframe.contentDocument
        if (!doc || !frame.element.isConnected) return
        const place = overlayer => Object.assign(overlayer.element.style, frame.onZoom
            ? { width: '100%', height: '100%', transform: 'none' }
            : { width: `${frame.width}px`, height: `${frame.height}px`,
                transform: `scale(${scale})`, transformOrigin: 'top left' })
        if (frame.overlayer) {
            place(frame.overlayer)
            frame.overlayer.redraw()
            return
        }
        this.dispatchEvent(new CustomEvent('create-overlayer', {
            detail: {
                doc, index: frame.index,
                attach: overlayer => {
                    frame.overlayer = overlayer
                    place(overlayer)
                    frame.element.append(overlayer.element)
                },
            },
        }))
    }
    #render(side = this.#side) {
        if (!side || this.#flow === 'scrolled') return
        const left = this.#left ?? {}
        const right = this.#center ?? this.#right ?? {}
        const target = side === 'left' ? left : right
        const { width, height } = this.getBoundingClientRect()
        const spread = this.#effectiveSpread
        const portrait = spread !== 'both' && spread !== 'portrait'
            && height > width
        this.#portrait = portrait
        const blankWidth = left.width ?? right.width ?? 0
        const blankHeight = left.height ?? right.height ?? 0

        const scale = typeof this.#zoom === 'number' && !isNaN(this.#zoom)
            ? this.#zoom
            : (this.#zoom === 'fit-width'
                ? (portrait || this.#center
                    ? width / (target.width ?? blankWidth)
                    : width / ((left.width ?? blankWidth) + (right.width ?? blankWidth)))
                : (portrait || this.#center
                    ? Math.min(
                        width / (target.width ?? blankWidth),
                        height / (target.height ?? blankHeight))
                    : Math.min(
                        width / ((left.width ?? blankWidth) + (right.width ?? blankWidth)),
                        height / Math.max(
                            left.height ?? blankHeight,
                            right.height ?? blankHeight)))
            ) || 1
        this.#setScale(scale)

        const shown = []
        const transform = frame => {
            if (!frame.iframe) return
            this.#transformFrame(frame, scale, blankWidth, blankHeight)
            if (portrait && frame !== target) frame.element.style.display = 'none'
            else shown.push(frame.element)
        }
        if (this.#center) {
            transform(this.#center)
        } else {
            transform(left)
            transform(right)
        }
        // Centred while they fit, and still all reachable once zoomed wider.
        shown.forEach((el, i) => Object.assign(el.style, {
            marginInlineStart: i === 0 ? 'auto' : '0',
            marginInlineEnd: i === shown.length - 1 ? 'auto' : '0',
        }))
    }
    async #showSpread({ left, right, center, side }) {
        this.#root.replaceChildren()
        this.scrollTop = 0
        this.#left = null
        this.#right = null
        this.#center = null
        if (center) {
            this.#center = await this.#createFrame(center)
            this.#side = 'center'
            this.#render()
        } else {
            this.#left = await this.#createFrame(left)
            this.#right = await this.#createFrame(right)
            this.#side = this.#left.blank ? 'right'
                : this.#right.blank ? 'left' : side
            this.#render()
        }
    }
    #goLeft() {
        if (this.#center || this.#left?.blank) return
        if (this.#portrait && this.#left?.element?.style?.display === 'none') {
            this.#side = 'left'
            this.#render()
            this.#reportLocation('page')
            return true
        }
    }
    #goRight() {
        if (this.#center || this.#right?.blank) return
        if (this.#portrait && this.#right?.element?.style?.display === 'none') {
            this.#side = 'right'
            this.#render()
            this.#reportLocation('page')
            return true
        }
    }
    open(book) {
        this.book = book
        const { rendition } = book
        this.spread = rendition?.spread
        this.defaultViewport = rendition?.viewport

        const rtl = book.dir === 'rtl'
        this.rtl = rtl
        this.#buildSpreads()
        if (this.#flow === 'scrolled') this.#setupScroll()
    }
    #buildSpreads() {
        const { book } = this
        const rtl = this.rtl
        const ltr = !rtl
        if (this.#effectiveSpread === 'none')
            this.#spreads = book.sections.map(section => ({ center: section }))
        else this.#spreads = book.sections.reduce((arr, section, i) => {
            const last = arr[arr.length - 1]
            const { pageSpread } = section
            const newSpread = () => {
                const spread = {}
                arr.push(spread)
                return spread
            }
            if (pageSpread === 'center') {
                const spread = last.left || last.right ? newSpread() : last
                spread.center = section
            }
            else if (pageSpread === 'left') {
                const spread = last.center || last.left || ltr && i ? newSpread() : last
                spread.left = section
            }
            else if (pageSpread === 'right') {
                const spread = last.center || last.right || rtl && i ? newSpread() : last
                spread.right = section
            }
            else if (ltr) {
                if (last.center || last.right) newSpread().left = section
                else if (last.left || !i) last.right = section
                else last.left = section
            }
            else {
                if (last.center || last.left) newSpread().right = section
                else if (last.right || !i) last.left = section
                else last.right = section
            }
            return arr
        }, [{}])
    }
    // TBV: a change of layout keeps the page being read.
    #rebuild() {
        const at = this.#index >= 0 || this.#scrollIndex >= 0 ? this.index : -1
        this.#teardownScroll()
        this.#root.replaceChildren()
        this.#left = this.#right = this.#center = null
        this.#index = -1
        this.#buildSpreads()
        if (this.#flow === 'scrolled') this.#setupScroll()
        if (at >= 0) this.goTo({ index: at })
    }
    get index() {
        if (this.#flow === 'scrolled') return this.#scrollIndex
        const spread = this.#spreads[this.#index]
        const section = spread?.center ?? (this.#side === 'left'
            ? spread.left ?? spread.right : spread.right ?? spread.left)
        return this.book.sections.indexOf(section)
    }
    #reportLocation(reason) {
        this.dispatchEvent(new CustomEvent('relocate', { detail:
            { reason, range: null, index: this.index, fraction: 0, size: 1 } }))
    }
    getSpreadOf(section) {
        const spreads = this.#spreads
        for (let index = 0; index < spreads.length; index++) {
            const { left, right, center } = spreads[index]
            if (left === section) return { index, side: 'left' }
            if (right === section) return { index, side: 'right' }
            if (center === section) return { index, side: 'center' }
        }
    }
    async goToSpread(index, side, reason) {
        if (index < 0 || index > this.#spreads.length - 1) return
        if (index === this.#index) {
            // TBV: a second call while the first is still showing it waits for it.
            await this.#showing
            this.#render(side)
            return
        }
        this.#index = index
        const showing = this.#showing = this.#goToSpread(index, side, reason)
        await showing
    }
    async #goToSpread(index, side, reason) {
        const spread = this.#spreads[index]
        if (spread.center) {
            const index = this.book.sections.indexOf(spread.center)
            const src = await spread.center?.load?.()
            await this.#showSpread({ center: { index, src } })
        } else {
            const indexL = this.book.sections.indexOf(spread.left)
            const indexR = this.book.sections.indexOf(spread.right)
            const srcL = await spread.left?.load?.()
            const srcR = await spread.right?.load?.()
            const left = { index: indexL, src: srcL }
            const right = { index: indexR, src: srcR }
            await this.#showSpread({ left, right, side })
        }
        // Once the pages' words are in place, for anything that reads them next.
        await Promise.all([this.#center, this.#left, this.#right].map(f => f?.drawing))
        this.#reportLocation(reason)
    }
    async select(target) {
        await this.goTo(target)
        // TODO
    }
    async goTo(target) {
        const { book } = this
        const resolved = await target
        const section = book.sections[resolved.index]
        if (!section) return
        if (this.#flow === 'scrolled') return this.#scrollToPage(resolved.index, 'navigation')
        const { index, side } = this.getSpreadOf(section)
        await this.goToSpread(index, side)
    }
    async next() {
        if (this.#flow === 'scrolled') return this.#scrollByScreen(1)
        const s = this.rtl ? this.#goLeft() : this.#goRight()
        if (!s) return this.goToSpread(this.#index + 1, this.rtl ? 'right' : 'left', 'page')
    }
    async prev() {
        if (this.#flow === 'scrolled') return this.#scrollByScreen(-1)
        const s = this.rtl ? this.#goRight() : this.#goLeft()
        if (!s) return this.goToSpread(this.#index - 1, this.rtl ? 'left' : 'right', 'page')
    }
    getContents() {
        // TBV: with the page being read first, which is what reading aloud uses.
        const frames = this.#flow === 'scrolled'
            ? this.#pages.map(p => p.frame).filter(Boolean)
                .sort((a, b) => (b.index === this.#scrollIndex) - (a.index === this.#scrollIndex))
            : this.#center ? [this.#center]
            : this.#side === 'left' ? [this.#left, this.#right] : [this.#right, this.#left]
        return frames
            .filter(f => f?.iframe && !f.blank && f.iframe.contentDocument)
            .filter(f => f.element.style.display !== 'none')
            .map(f => ({ doc: f.iframe.contentDocument, index: f.index, overlayer: f.overlayer }))
    }

    // TBV: scrolling through every page in one column. Only pages near the
    // screen have frames; the rest are empty holders of the right size.
    #setupScroll() {
        const column = document.createElement('div')
        column.className = 'column'
        this.#pages = this.book.sections.map((section, index) => {
            const holder = document.createElement('div')
            holder.className = 'holder'
            column.append(holder)
            return { index, section, holder, frame: null, loading: null }
        })
        this.#root.replaceChildren(column)
        this.#scrollIndex = -1
        this.#layoutScroll(false)
    }
    #teardownScroll() {
        this.#pages = []
        this.#scrollIndex = -1
    }
    #sizeOf(index) {
        return this.#sizes.get(index) ?? this.#sizes.values().next().value ?? { width: 612, height: 792 }
    }
    #scaleFor({ width, height }) {
        if (typeof this.#zoom === 'number' && !isNaN(this.#zoom)) return this.#zoom
        const w = this.clientWidth - SCROLL_GAP * 2
        const h = this.clientHeight - SCROLL_GAP * 2
        if (w <= 0 || h <= 0) return 1
        return (this.#zoom === 'fit-width' ? w / width : Math.min(w / width, h / height)) || 1
    }
    // Where in the column the reader is, as a page and how far down it.
    #place() {
        const i = this.#scrollIndex
        const page = this.#pages[i]
        if (!page) return null
        const { offsetTop, offsetHeight } = page.holder
        return { index: i, within: offsetHeight ? (this.scrollTop - offsetTop) / offsetHeight : 0 }
    }
    #layoutScroll(keepPlace = true) {
        if (!this.#pages.length) return
        const place = keepPlace ? this.#place() : null
        let current = 1
        for (const page of this.#pages) {
            const size = page.frame && !page.frame.blank ? page.frame : this.#sizeOf(page.index)
            const scale = this.#scaleFor(size)
            if (page.index === Math.max(0, this.#scrollIndex)) current = scale
            page.holder.style.width = `${size.width * scale}px`
            page.holder.style.height = `${size.height * scale}px`
            if (page.frame) {
                this.#transformFrame(page.frame, scale, size.width, size.height)
                page.frame.element.style.marginInline = '0'
            }
        }
        this.#setScale(current)
        if (place) {
            const { offsetTop, offsetHeight } = this.#pages[place.index].holder
            this.scrollTop = offsetTop + place.within * offsetHeight
        }
        this.#onScroll()
    }
    #pageAt(y) {
        const pages = this.#pages
        let lo = 0, hi = pages.length - 1
        while (lo < hi) {
            const mid = (lo + hi) >> 1
            const { offsetTop, offsetHeight } = pages[mid].holder
            if (offsetTop + offsetHeight + SCROLL_GAP <= y) lo = mid + 1
            else hi = mid
        }
        return lo
    }
    #onScroll() {
        if (this.#flow !== 'scrolled' || !this.#pages.length) return
        cancelAnimationFrame(this.#scrollFrame)
        this.#scrollFrame = requestAnimationFrame(() => {
            const top = this.scrollTop
            const first = this.#pageAt(top)
            const last = this.#pageAt(top + this.clientHeight)
            this.#loadAround(first, last)
            // The page under the top third of the screen is the one being read.
            const reading = this.#pageAt(top + Math.min(this.clientHeight / 3, 240))
            if (reading !== this.#scrollIndex) {
                this.#scrollIndex = reading
                this.#reportLocation('scroll')
            }
        })
    }
    #loadAround(first, last) {
        const keepFrom = first - 3, keepTo = last + 3
        for (const page of this.#pages) {
            if (page.frame && (page.index < keepFrom || page.index > keepTo)) {
                page.frame = null
                page.holder.replaceChildren()
            }
        }
        for (let i = Math.max(0, first - 1); i <= Math.min(this.#pages.length - 1, last + 1); i++)
            this.#loadPage(this.#pages[i])
    }
    #loadPage(page) {
        if (page.frame) return Promise.resolve()
        page.loading ??= this.#load(page).finally(() => { page.loading = null })
        return page.loading
    }
    async #load(page) {
        const src = await page.section.load?.()
        if (!this.#pages.includes(page)) return
        const frame = await this.#createFrame({ index: page.index, src }, page.holder)
        if (!this.#pages.includes(page) || !frame.element.isConnected) return
        page.frame = frame
        const known = this.#sizes.get(page.index)
        if (!frame.blank) this.#sizes.set(page.index, { width: frame.width, height: frame.height })
        if (!known || known.width !== frame.width || known.height !== frame.height) this.#layoutScroll(true)
        else {
            const scale = this.#scaleFor(frame)
            this.#transformFrame(frame, scale, frame.width, frame.height)
            frame.element.style.marginInline = '0'
        }
    }
    async #scrollToPage(index, reason) {
        const page = this.#pages[index]
        if (!page) return
        this.scrollTop = page.holder.offsetTop - SCROLL_GAP
        this.#scrollIndex = index
        this.#onScroll()
        await this.#loadPage(page)
        await page.frame?.drawing
        this.#reportLocation(reason)
    }
    async #scrollByScreen(direction) {
        this.scrollBy({ top: direction * this.clientHeight * 0.9 })
    }
    /** TBV: on to the page after the one being read (reading aloud). */
    async nextSection() {
        const index = this.index + 1
        if (index > 0 && index < this.book.sections.length)
            await this.goTo({ index })
    }
    /** TBV: brings a range on a page into view (reading aloud, scrolling). */
    async scrollToAnchor(range) {
        if (this.#flow !== 'scrolled' || !range?.getBoundingClientRect) return
        const doc = range.startContainer?.ownerDocument
        const frame = this.#pages.find(p => p.frame?.iframe.contentDocument === doc)?.frame
        if (!frame) return
        const r = range.getBoundingClientRect()
        const top = frame.element.getBoundingClientRect().top + r.top
        const box = this.getBoundingClientRect()
        if (top < box.top + 40 || top + r.height > box.bottom - 40)
            this.scrollBy({ top: top - box.top - this.clientHeight / 3 })
    }
    /** TBV: scrolls a little, for the arrow keys. */
    scrollStep(direction) {
        if (this.#flow === 'scrolled' || this.scrollHeight > this.clientHeight)
            this.scrollBy({ top: direction * 80 })
    }
    destroy() {
        this.#observer.unobserve(this)
        cancelAnimationFrame(this.#scrollFrame)
    }
}

customElements.define('foliate-fxl', FixedLayout)
