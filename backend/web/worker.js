import { handleOptions, checkAuth, jsonError } from "./middleware.js";
import { handleUpload, handleSearch, handleListNotes, handleGetNoteById, handleGetNote, handleDeleteNote } from "./handlers/notes.js";
import { handleSaveChunk, handleSaveSession, handleListSessions, handleGetSession, handleSaveSnap } from "./handlers/sessions.js";
import { handleVectorSearch, handleVectorTest, handleSessionSearch, handleListProjects, handleLatestSession } from "./handlers/search.js";
import { HTML_PAGE } from "./views/dashboard.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return handleOptions();

    if (url.pathname === "/" && request.method === "GET") {
      return new Response(HTML_PAGE, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    const authError = checkAuth(request, env);
    if (authError) return authError;

    // Notes
    if (url.pathname === "/api/upload" && request.method === "POST") return handleUpload(request, env);
    if (url.pathname === "/api/search" && request.method === "GET") return handleSearch(url, env);
    if (url.pathname === "/api/notes" && request.method === "GET") return handleListNotes(env);
    if (url.pathname.startsWith("/api/noteid/") && request.method === "GET") return handleGetNoteById(url, env);
    if (url.pathname.startsWith("/api/note/") && request.method === "GET") return handleGetNote(url, env);
    if (url.pathname.startsWith("/api/note/") && request.method === "DELETE") return handleDeleteNote(url, env);

    // Vector
    if (url.pathname === "/api/vector-search" && request.method === "GET") return handleVectorSearch(url, env);
    if (url.pathname === "/api/vector-test" && request.method === "GET") return handleVectorTest(url, env);

    // Sessions
    if (url.pathname === "/api/session/chunk" && request.method === "POST") return handleSaveChunk(request, env);
    if (url.pathname === "/api/session" && request.method === "POST") return handleSaveSession(request, env);
    if (url.pathname === "/api/sessions" && request.method === "GET") return handleListSessions(url, env);
    if (url.pathname === "/api/session/snap" && request.method === "POST") return handleSaveSnap(request, env);
    if (url.pathname === "/api/sessions/search" && request.method === "GET") return handleSessionSearch(url, env);
    if (url.pathname === "/api/sessions/projects" && request.method === "GET") return handleListProjects(env);
    if (url.pathname === "/api/sessions/latest" && request.method === "GET") return handleLatestSession(url, env);
    if (url.pathname.startsWith("/api/session/") && request.method === "GET") return handleGetSession(url, env);

    return jsonError("Not found", 404);
  }
};
