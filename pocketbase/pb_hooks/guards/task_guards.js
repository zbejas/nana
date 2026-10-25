/// <reference path="../../pb_data/types.d.ts" />

// Guard: an existing task can only be moved to a board the caller owns and
// that is still active. PocketBase evaluates relation rules against the stored
// record, so this check is required for the new `board` value on update.
onRecordUpdateRequest((e) => {
  if (!e.auth || e.hasSuperuserAuth()) {
    return e.next();
  }

  const boardId = e.record.getString("board");
  if (!boardId) {
    throw new BadRequestError("A task must belong to a board.");
  }

  let board;
  try {
    board = $app.findRecordById("boards", boardId);
  } catch (_) {
    throw new BadRequestError("Board not found.");
  }

  if (board.getString("author") !== e.auth.id) {
    throw new BadRequestError("You can only use your own boards.");
  }

  if (board.getBool("archived")) {
    throw new BadRequestError("Archived boards cannot be changed.");
  }

  return e.next();
}, "tasks");
