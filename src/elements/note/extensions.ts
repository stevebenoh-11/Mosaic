import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Placeholder from '@tiptap/extension-placeholder';
import type { Extensions } from '@tiptap/core';

/**
 * Shared between the live editor and static HTML rendering so stored docs
 * always round-trip. TipTap's own history is disabled — undo/redo flows
 * through the app-wide command history (text batched per editing session).
 */
export function noteExtensions(placeholder = 'Type something…'): Extensions {
  return [
    StarterKit.configure({
      history: false,
      heading: { levels: [1, 2, 3] },
    }),
    Link.configure({ openOnClick: false, autolink: true }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Placeholder.configure({ placeholder }),
  ];
}
