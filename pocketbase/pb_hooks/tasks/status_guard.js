/// <reference path="../../pb_data/types.d.ts" />

// `tasks.status` is a text slug, so PocketBase's field validation cannot
// enforce membership in a board's workflow. This guard rejects unknown statuses
// on every API create/update, including direct PocketBase writes that bypass
// the Elysia facade. `planned` and `archived` are virtual backlog statuses and
// never have a `board_columns` row.
//
// Every hook keeps its logic inside the callback: module-scope bindings do not
// survive into PocketBase JSVM hook invocations.

onRecordCreateRequest((e) => {
  if (!e.auth || e.hasSuperuserAuth()) return e.next()

  const status = String(e.record.get("status") || "").trim()
  if (!status) throw new BadRequestError("Choose a task status.")
  if (status !== "planned" && status !== "archived") {
    const boardId = String(e.record.get("board") || "")
    if (!boardId) throw new BadRequestError("A task requires a board.")
    const columns = $app.findRecordsByFilter(
      "board_columns",
      "board = {:board} && slug = {:status}",
      "",
      1,
      0,
      { board: boardId, status: status }
    )
    if (columns.length === 0) {
      throw new BadRequestError("That task status does not exist on this board.")
    }
  }

  return e.next()
}, "tasks")

onRecordUpdateRequest((e) => {
  if (!e.auth || e.hasSuperuserAuth()) return e.next()

  const status = String(e.record.get("status") || "").trim()
  if (!status) throw new BadRequestError("Choose a task status.")
  if (status !== "planned" && status !== "archived") {
    const boardId = String(e.record.get("board") || "")
    if (!boardId) throw new BadRequestError("A task requires a board.")
    const columns = $app.findRecordsByFilter(
      "board_columns",
      "board = {:board} && slug = {:status}",
      "",
      1,
      0,
      { board: boardId, status: status }
    )
    if (columns.length === 0) {
      throw new BadRequestError("That task status does not exist on this board.")
    }
  }

  return e.next()
}, "tasks")

// The virtual backlog keys never belong to a real column. Without this guard,
// a column named `planned` could be marked final and its tasks would be treated
// as complete by the lifecycle hook.
onRecordCreateRequest((e) => {
  if (!e.auth || e.hasSuperuserAuth()) return e.next()
  const slug = String(e.record.get("slug") || "").trim().toLowerCase()
  if (slug === "planned" || slug === "archived") {
    throw new BadRequestError("That column key is reserved for the virtual backlog.")
  }
  return e.next()
}, "board_columns")

onRecordUpdateRequest((e) => {
  if (!e.auth || e.hasSuperuserAuth()) return e.next()
  const slug = String(e.record.get("slug") || "").trim().toLowerCase()
  if (slug === "planned" || slug === "archived") {
    throw new BadRequestError("That column key is reserved for the virtual backlog.")
  }
  return e.next()
}, "board_columns")
