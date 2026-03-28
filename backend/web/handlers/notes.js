import { corsHeaders, jsonOk, jsonError } from "../middleware.js";

async function getUniqueName(db, fileName, content) {
  const existing = await db.prepare("SELECT file_name, content FROM notes WHERE file_name = ?").bind(fileName).first();
  if (!existing) return fileName;
  if (existing.content && existing.content.trim() === content.trim()) return fileName;
  const base = fileName.replace(/\.md$/, "");
  const rows = await db.prepare("SELECT file_name FROM notes WHERE file_name LIKE ?").bind(base + "%").all();
  const names = new Set((rows.results || []).map(r => r.file_name));
  let n = 1; let newName;
  do { newName = base + "-" + n + ".md"; n++; } while (names.has(newName));
  return newName;
}

export async function handleUpload(request, env) {
  try {
    let { file_name, title, date, tags, frontmatter, content, folder } = await request.json();
    if (!file_name || !content) return jsonError("file_name과 content 필수", 400);
    if (folder) file_name = folder + "/" + file_name;
    const uniqueName = await getUniqueName(env.DB, file_name, content);
    const finalTitle = title || uniqueName.replace(/\.md$/, "").split("/").pop();
    await env.DB.prepare(
      "INSERT INTO notes (file_name, title, date, tags, frontmatter, content, synced_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now')) ON CONFLICT(file_name) DO UPDATE SET title=excluded.title, date=excluded.date, tags=excluded.tags, frontmatter=excluded.frontmatter, content=excluded.content, synced_at=datetime('now')"
    ).bind(uniqueName, finalTitle, date || "", tags || "", frontmatter || "", content).run();
    const renamed = uniqueName !== file_name;
    return jsonOk({ ok: true, file_name: uniqueName, renamed, original: renamed ? file_name : undefined });
  } catch (e) { return jsonError(e.message); }
}

export async function handleSearch(url, env) {
  const q = url.searchParams.get("q") || "";
  const results = await env.DB.prepare(
    "SELECT file_name, title, date, tags, substr(content, 1, 200) as preview FROM notes WHERE content LIKE ? OR title LIKE ? ORDER BY synced_at DESC LIMIT 30"
  ).bind(`%${q}%`, `%${q}%`).all();
  return jsonOk(results);
}

export async function handleListNotes(env) {
  const results = await env.DB.prepare(
    "SELECT file_name, title, date, tags, synced_at FROM notes ORDER BY synced_at DESC LIMIT 50"
  ).all();
  return jsonOk(results);
}

export async function handleGetNoteById(url, env) {
  try {
    const nid = parseInt(url.pathname.replace("/api/noteid/", ""));
    const note = await env.DB.prepare("SELECT * FROM notes WHERE id = ?").bind(nid).first();
    if (!note) return jsonError("Not found id", 404);
    return jsonOk(note);
  } catch (e) { return jsonError(e.message); }
}

export async function handleGetNote(url, env) {
  const fname = decodeURIComponent(url.pathname.replace("/api/note/", ""));
  const result = await env.DB.prepare("SELECT * FROM notes WHERE file_name = ?").bind(fname).first();
  if (!result) return jsonError("Not found", 404);
  return jsonOk(result);
}

export async function handleDeleteNote(url, env) {
  const fname = decodeURIComponent(url.pathname.replace("/api/note/", ""));
  await env.DB.prepare("DELETE FROM notes WHERE file_name = ?").bind(fname).run();
  return jsonOk({ ok: true, deleted: fname });
}
