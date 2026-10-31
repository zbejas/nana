/// <reference path="../../pb_data/types.d.ts" />

// Document revisions are the optimistic-concurrency token for normal saves and
// AI edits. The actor label lets the editor say "Nana edited this" without
// inventing a fake user account.

function text(record, field) {
  const value = record.get(field)
  if (value === null || value === undefined) return ""
  return String(value)
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function headerValue(info, name) {
  const headers = (info && info.headers) || {}
  const wanted = String(name || "").toLowerCase()
  for (const key in headers) {
    const normalized = String(key).toLowerCase().replace(/_/g, "-")
    if (normalized !== wanted) continue
    const value = headers[key]
    return Array.isArray(value) ? String(value[0] || "") : String(value || "")
  }
  return ""
}

function actorFor(auth, info) {
  const requested = headerValue(info, "X-Nana-Actor").toLowerCase()
  if (requested === "ai") {
    return { source: "ai", type: "ai", label: "Nana" }
  }
  if (requested === "system") {
    return { source: "system", type: "system", label: "System" }
  }
  if (auth) {
    const name = text(auth, "name") || auth.email() || "You"
    return { source: "user", type: "user", label: name }
  }
  return { source: "system", type: "system", label: "System" }
}

function applyActor(record, auth, info) {
  const actor = actorFor(auth, info)
  record.set("last_edited_by", actor.label)
  record.set("last_edit_source", actor.source)
  return actor
}

function initializeDocument(record, auth, info) {
  record.set("revision", 1)
  applyActor(record, auth, info)
}

/**
 * Compares the incoming record with its stored state. Content/title/tags
 * changes bump `revision` and stamp the actor. A caller that supplies an old
 * revision is rejected before the write; a caller that omits revision (older
 * clients) is still allowed and simply gets the next revision.
 */
function submittedRevision(info) {
  let body = info && info.body
  if (typeof body === "string") {
    try {
      body = JSON.parse(body)
    } catch (_) {
      return null
    }
  }
  if (!body || typeof body !== "object") return null
  if (!Object.prototype.hasOwnProperty.call(body, "revision")) return null
  const value = Number(body.revision)
  return Number.isFinite(value) ? value : null
}

function syncDocumentEdit(record, original, auth, info) {
  if (!original || !original.id) return

  const contentChanged =
    text(record, "content") !== text(original, "content") ||
    text(record, "title") !== text(original, "title") ||
    !sameJson(record.get("tags") || [], original.get("tags") || [])

  if (contentChanged) {
    const current = Number(original.get("revision") || 0)
    const submitted = submittedRevision(info)
    const aiRequest = headerValue(info, "X-Nana-Actor").toLowerCase() === "ai"
    if (submitted !== null && submitted !== current) {
      throw new BadRequestError("This note changed since it was loaded. Reload it and try again.")
    }
    if (aiRequest && submitted === null) {
      throw new BadRequestError("An AI edit must include the note revision.")
    }
    record.set("revision", current + 1)
  }

  applyActor(record, auth, info)
}

module.exports = {
  actorFor,
  applyActor,
  headerValue,
  initializeDocument,
  syncDocumentEdit,
}
