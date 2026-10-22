// TBV: PDF.js comes from the pdfjs-dist package (bundled by Vite), and its
// worker, fonts and character maps are served at /pdfjs/ (see vite.config.ts).
// The "legacy" build carries its own copies of the newest JavaScript
// features, so it works in older versions of Windows' web view too.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import textLayerBuilderCSS from './vendor/pdfjs/text_layer_builder.css?raw'
import annotationLayerBuilderCSS from './vendor/pdfjs/annotation_layer_builder.css?raw'

const pdfjsPath = path => new URL(`${import.meta.env.BASE_URL}pdfjs/${path}`, location.href).toString()
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsPath('pdf.worker.min.mjs')

// TBV: PDF sizes are in points (1/72 inch); pages are laid out in CSS pixels
// (1/96 inch), so 100% is the page's real size, as in other PDF readers.
const CSS_UNITS = 96 / 72

// TBV: phones refuse canvases above about 16 million pixels (iPhone), so a
// page zoomed far in is drawn a little softer rather than not at all.
const MAX_CANVAS_PIXELS = 16_000_000

// TBV: what each page's frame holds between drawings, so zooming draws the
// picture again but keeps the text layer (where highlights are anchored).
const drawn = new WeakMap()

const render = async (page, doc, zoom) => {
    const state = drawn.get(doc) ?? {}
    drawn.set(doc, state)
    const token = state.token = (state.token ?? 0) + 1
    state.task?.cancel()

    const dpr = devicePixelRatio || 1
    const cssViewport = page.getViewport({ scale: zoom * CSS_UNITS * dpr })
    doc.documentElement.style.transform = `scale(${1 / dpr})`
    doc.documentElement.style.transformOrigin = 'top left'
    doc.documentElement.style.setProperty('--scale-factor', zoom * CSS_UNITS * dpr)

    // The old picture is stretched to the new size until the new one is ready.
    const old = doc.querySelector('#canvas canvas')
    if (old) Object.assign(old.style, {
        width: `${cssViewport.width}px`, height: `${cssViewport.height}px` })

    const pixels = cssViewport.width * cssViewport.height
    const shrink = pixels > MAX_CANVAS_PIXELS ? Math.sqrt(MAX_CANVAS_PIXELS / pixels) : 1
    const viewport = shrink < 1
        ? page.getViewport({ scale: zoom * CSS_UNITS * dpr * shrink }) : cssViewport

    // the canvas must be in the `PDFDocument`'s `ownerDocument`
    // (`globalThis.document` by default); that's where the fonts are loaded
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    Object.assign(canvas.style, {
        width: `${cssViewport.width}px`, height: `${cssViewport.height}px`, display: 'block' })
    const canvasContext = canvas.getContext('2d')
    const task = state.task = page.render({ canvasContext, viewport })
    try {
        await task.promise
    } catch (e) {
        if (e?.name === 'RenderingCancelledException') return false
        throw e
    }
    // A newer drawing (another zoom) has started; it will show instead.
    if (token !== state.token) return false
    state.task = null
    doc.querySelector('#canvas').replaceChildren(doc.adoptNode(canvas))

    // The text and link layers are built once, then only resized.
    state.layers ??= buildLayers(page, doc, cssViewport)
    const { textLayer, annotationLayer } = await state.layers
    if (token !== state.token) return false
    textLayer.update({ viewport: cssViewport })
    annotationLayer.update({ viewport: cssViewport })
    return true
}

const buildLayers = async (page, doc, viewport) => {
    const container = doc.querySelector('.textLayer')
    container.replaceChildren()
    const textLayer = new pdfjsLib.TextLayer({
        textContentSource: await page.streamTextContent(),
        container, viewport,
    })
    await textLayer.render()

    // hide "offscreen" canvases appended to docuemnt when rendering text layer
    // https://github.com/mozilla/pdf.js/blob/642b9a5ae67ef642b9a8808fd9efd447e8c350e2/web/pdf_viewer.css#L51-L58
    for (const canvas of document.querySelectorAll('.hiddenCanvasElement'))
        Object.assign(canvas.style, {
            position: 'absolute',
            top: '0',
            left: '0',
            width: '0',
            height: '0',
            display: 'none',
        })

    // fix text selection
    // https://github.com/mozilla/pdf.js/blob/642b9a5ae67ef642b9a8808fd9efd447e8c350e2/web/text_layer_builder.js#L105-L107
    const endOfContent = document.createElement('div')
    endOfContent.className = 'endOfContent'
    container.append(endOfContent)
    // TODO: this only works in Firefox; see https://github.com/mozilla/pdf.js/pull/17923
    container.onpointerdown = () => container.classList.add('selecting')
    container.onpointerup = () => container.classList.remove('selecting')

    const div = doc.querySelector('.annotationLayer')
    div.replaceChildren()
    const linkService = {
        goToDestination: () => {},
        getDestinationHash: dest => JSON.stringify(dest),
        addLinkAttributes: (link, url) => link.href = url,
    }
    const annotationLayer = new pdfjsLib.AnnotationLayer({ page, viewport, div, linkService })
    await annotationLayer.render({ annotations: await page.getAnnotations() })
    return { textLayer, annotationLayer }
}

// TBV: the page's words laid out as the text layer lays them out (spans,
// and a line break where a line ends), without drawing anything. Search
// reads these, and what it finds points at the same words on the page.
const textDocument = async page => {
    const doc = document.implementation.createHTMLDocument('')
    const canvas = doc.createElement('div')
    canvas.id = 'canvas'
    const layer = doc.createElement('div')
    layer.className = 'textLayer'
    const annotations = doc.createElement('div')
    annotations.className = 'annotationLayer'
    doc.body.append(canvas, layer, annotations)
    const { items } = await page.getTextContent()
    for (const item of items) {
        if (item.str === undefined) continue
        if (item.str !== '') {
            const span = doc.createElement('span')
            span.textContent = item.str
            layer.append(span)
        }
        if (item.hasEOL) layer.append(doc.createElement('br'))
    }
    return doc
}

const renderPage = async (page, getImageBlob) => {
    if (getImageBlob) {
        const viewport = page.getViewport({ scale: 1 })
        const canvas = document.createElement('canvas')
        canvas.height = viewport.height
        canvas.width = viewport.width
        const canvasContext = canvas.getContext('2d')
        await page.render({ canvasContext, viewport }).promise
        return new Promise(resolve => canvas.toBlob(resolve))
    }
    const viewport = page.getViewport({ scale: CSS_UNITS })
    const src = URL.createObjectURL(new Blob([`
        <!DOCTYPE html>
        <html lang="en">
        <meta charset="utf-8">
        <meta name="viewport" content="width=${viewport.width}, height=${viewport.height}">
        <style>
        html, body {
            margin: 0;
            padding: 0;
        }
        /*
        https://github.com/mozilla/pdf.js/commit/bd05b255fabfc313b194bfe9a17ccded4d90fb5a
        */
        :root {
          --user-unit: 1;
          --total-scale-factor: calc(var(--scale-factor) * var(--user-unit));
          --scale-round-x: 1px;
          --scale-round-y: 1px;
        }
        ${textLayerBuilderCSS}
        ${annotationLayerBuilderCSS}
        </style>
        <div id="canvas"></div>
        <div class="textLayer"></div>
        <div class="annotationLayer"></div>
    `], { type: 'text/html' }))
    const onZoom = ({ doc, scale }) => render(page, doc, scale)
    return { src, onZoom }
}

const makeTOCItem = item => ({
    label: item.title,
    href: JSON.stringify(item.dest),
    subitems: item.items.length ? item.items.map(makeTOCItem) : null,
})

export const makePDF = async file => {
    const transport = new pdfjsLib.PDFDataRangeTransport(file.size, [])
    transport.requestDataRange = (begin, end) => {
        file.slice(begin, end).arrayBuffer().then(chunk => {
            transport.onDataRange(begin, chunk)
        })
    }
    const pdf = await pdfjsLib.getDocument({
        range: transport,
        cMapUrl: pdfjsPath('cmaps/'),
        standardFontDataUrl: pdfjsPath('standard_fonts/'),
        wasmUrl: pdfjsPath('wasm/'),
        iccUrl: pdfjsPath('iccs/'),
        isEvalSupported: false,
    }).promise

    const book = { rendition: { layout: 'pre-paginated' } }

    const { metadata, info } = await pdf.getMetadata() ?? {}
    // TODO: for better results, parse `metadata.getRaw()`
    book.metadata = {
        title: metadata?.get('dc:title') ?? info?.Title,
        author: metadata?.get('dc:creator') ?? info?.Author,
        contributor: metadata?.get('dc:contributor'),
        description: metadata?.get('dc:description') ?? info?.Subject,
        language: metadata?.get('dc:language'),
        publisher: metadata?.get('dc:publisher'),
        subject: metadata?.get('dc:subject'),
        identifier: metadata?.get('dc:identifier'),
        source: metadata?.get('dc:source'),
        rights: metadata?.get('dc:rights'),
    }

    const outline = await pdf.getOutline()
    book.toc = outline?.map(makeTOCItem)

    const cache = new Map()
    book.sections = Array.from({ length: pdf.numPages }).map((_, i) => ({
        id: i,
        load: async () => {
            const cached = cache.get(i)
            if (cached) return cached
            const url = await renderPage(await pdf.getPage(i + 1))
            cache.set(i, url)
            return url
        },
        size: 1000,
        createDocument: async () => textDocument(await pdf.getPage(i + 1)),
    }))
    book.isExternal = uri => /^\w+:/i.test(uri)
    book.resolveHref = async href => {
        const parsed = JSON.parse(href)
        const dest = typeof parsed === 'string'
            ? await pdf.getDestination(parsed) : parsed
        const index = await pdf.getPageIndex(dest[0])
        return { index }
    }
    book.splitTOCHref = async href => {
        const parsed = JSON.parse(href)
        const dest = typeof parsed === 'string'
            ? await pdf.getDestination(parsed) : parsed
        const index = await pdf.getPageIndex(dest[0])
        return [index, null]
    }
    book.getTOCFragment = doc => doc.documentElement
    book.getCover = async () => renderPage(await pdf.getPage(1), true)
    // TBV: PDF.js 6 closes a document through the task that opened it.
    book.destroy = () => pdf.loadingTask.destroy()
    return book
}
