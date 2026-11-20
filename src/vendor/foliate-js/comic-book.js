// TBV: a comic's ComicInfo.xml can say it reads right to left (manga), as
// <Manga>YesAndRightToLeft</Manga>; the book's `dir` follows it.
export const comicDirection = async ({ entries, loadBlob }) => {
    const info = entries.find(entry => /(^|\/)comicinfo\.xml$/i.test(entry.filename))
    if (!info) return 'ltr'
    try {
        const text = await (await loadBlob(info.filename)).text()
        const doc = new DOMParser().parseFromString(text, 'application/xml')
        const manga = doc.getElementsByTagName('Manga')[0]?.textContent?.trim().toLowerCase()
        return manga === 'yesandrighttoleft' ? 'rtl' : 'ltr'
    } catch {
        return 'ltr'
    }
}

export const makeComicBook = async ({ entries, loadBlob, getSize }, file) => {
    const cache = new Map()
    const urls = new Map()
    const load = async name => {
        if (cache.has(name)) return cache.get(name)
        const src = URL.createObjectURL(await loadBlob(name))
        const page = URL.createObjectURL(
            new Blob([`<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin: 0"><img src="${src}"></body></html>`], { type: 'text/html' }))
        urls.set(name, [src, page])
        cache.set(name, page)
        return page
    }
    const unload = name => {
        urls.get(name)?.forEach?.(url => URL.revokeObjectURL(url))
        urls.delete(name)
        cache.delete(name)
    }

    const exts = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.jxl', '.avif']
    const files = entries
        .map(entry => entry.filename)
        .filter(name => exts.some(ext => name.toLowerCase().endsWith(ext)))
        .sort(new Intl.Collator([], { numeric: true }).compare)
    if (!files.length) throw new Error('No supported image files in archive')

    const book = {}
    book.getCover = () => loadBlob(files[0])
    book.metadata = { title: file.name }
    book.sections = files.map(name => ({
        id: name,
        load: () => load(name),
        unload: () => unload(name),
        size: getSize(name),
    }))
    book.toc = files.map(name => ({ label: name, href: name }))
    book.rendition = { layout: 'pre-paginated' }
    book.dir = await comicDirection({ entries, loadBlob })
    book.resolveHref = href => ({ index: book.sections.findIndex(s => s.id === href) })
    book.splitTOCHref = href => [href, null]
    book.getTOCFragment = doc => doc.documentElement
    book.destroy = () => {
        for (const arr of urls.values())
            for (const url of arr) URL.revokeObjectURL(url)
    }
    return book
}
