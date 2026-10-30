/**
 * Persisted chat tool names.
 *
 * Kept in a leaf module so message persistence (which allowlists tool activity)
 * does not import the tool implementations, and the implementations can import
 * persistence without a module cycle.
 */

export const CHAT_READ_TOOL_NAMES = [
    "list_notes",
    "read_note",
    "list_boards",
    "read_board",
    "list_tasks",
    "read_task",
] as const;

export const CHAT_WRITE_TOOL_NAMES = [
    "create_note",
    "append_note",
    "edit_note",
    "update_note",
    "create_board",
    "create_task",
    "update_task",
    "move_task",
] as const;

/** Persisted activity allowlist. Adding a tool requires extending this list. */
export const CHAT_TOOL_NAMES = [
    ...CHAT_READ_TOOL_NAMES,
    ...CHAT_WRITE_TOOL_NAMES,
] as const;
