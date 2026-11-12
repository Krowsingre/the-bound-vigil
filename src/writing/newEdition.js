// Starting a new edition of a book: a copy of it with all its pages, linked
// to the earlier edition, numbered one on, with no ISBNs yet (each format of
// a new edition needs its own, and they're optional).
import { api } from "../api";
import { editionOrFirst, nextEdition } from "./bookEditions";
import { readExport } from "./epub";
export async function startNewEdition(project) {
    const settings = readExport(project.export);
    const current = editionOrFirst(settings, project.createdAt.slice(0, 4));
    // The earlier edition joins the group too, so the two are linked.
    if (!settings.edition)
        await api.setWritingExport(project.id, JSON.stringify({ ...settings, edition: current }));
    const copy = await api.duplicateWritingProject(project.id);
    const next = nextEdition(current);
    const copied = readExport(copy.project.export);
    await api.setWritingExport(copy.project.id, JSON.stringify({ ...copied, edition: next, copyright: { ...copied.copyright, isbn: "", edition: "", year: "" } }));
    const p = copy.project;
    await api.updateWritingDetails(p.id, { title: project.title, author: p.author, series: p.series, seriesIndex: p.seriesIndex, language: p.language, description: p.description });
    return api.writingProject(p.id);
}
