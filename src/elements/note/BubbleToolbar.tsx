import type { Editor } from '@tiptap/react';
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
} from 'lucide-react';
import type { ReactNode } from 'react';

function ToolButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      // preventDefault keeps focus inside the editor
      onPointerDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`rounded p-1 ${active ? 'bg-accent-soft text-accent' : 'text-ink-soft hover:bg-panel-border/60 hover:text-ink'}`}
    >
      {children}
    </button>
  );
}

export function BubbleToolbar({ editor }: { editor: Editor }) {
  function setLink() {
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Link URL', prev ?? 'https://');
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().unsetLink().run();
    } else if (/^https?:\/\//i.test(url.trim())) {
      editor
        .chain()
        .focus()
        .extendMarkRange('link')
        .setLink({ href: url.trim() })
        .run();
    } else {
      window.alert('Only http(s) links are allowed.');
    }
  }

  const c = () => editor.chain().focus();
  return (
    <div
      className="absolute -top-10 left-0 z-50 flex items-center gap-0.5 rounded-lg border border-card-border bg-card px-1 py-0.5 shadow-card-drag"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <ToolButton label="Bold" active={editor.isActive('bold')} onClick={() => c().toggleBold().run()}>
        <Bold className="h-3.5 w-3.5" />
      </ToolButton>
      <ToolButton label="Italic" active={editor.isActive('italic')} onClick={() => c().toggleItalic().run()}>
        <Italic className="h-3.5 w-3.5" />
      </ToolButton>
      <span className="mx-0.5 h-4 w-px bg-card-border" />
      <ToolButton label="Heading 1" active={editor.isActive('heading', { level: 1 })} onClick={() => c().toggleHeading({ level: 1 }).run()}>
        <Heading1 className="h-3.5 w-3.5" />
      </ToolButton>
      <ToolButton label="Heading 2" active={editor.isActive('heading', { level: 2 })} onClick={() => c().toggleHeading({ level: 2 }).run()}>
        <Heading2 className="h-3.5 w-3.5" />
      </ToolButton>
      <ToolButton label="Heading 3" active={editor.isActive('heading', { level: 3 })} onClick={() => c().toggleHeading({ level: 3 }).run()}>
        <Heading3 className="h-3.5 w-3.5" />
      </ToolButton>
      <span className="mx-0.5 h-4 w-px bg-card-border" />
      <ToolButton label="Bullet list" active={editor.isActive('bulletList')} onClick={() => c().toggleBulletList().run()}>
        <List className="h-3.5 w-3.5" />
      </ToolButton>
      <ToolButton label="Numbered list" active={editor.isActive('orderedList')} onClick={() => c().toggleOrderedList().run()}>
        <ListOrdered className="h-3.5 w-3.5" />
      </ToolButton>
      <ToolButton label="Checklist" active={editor.isActive('taskList')} onClick={() => c().toggleTaskList().run()}>
        <ListChecks className="h-3.5 w-3.5" />
      </ToolButton>
      <span className="mx-0.5 h-4 w-px bg-card-border" />
      <ToolButton label="Inline code" active={editor.isActive('code')} onClick={() => c().toggleCode().run()}>
        <Code className="h-3.5 w-3.5" />
      </ToolButton>
      <ToolButton label="Link" active={editor.isActive('link')} onClick={setLink}>
        <LinkIcon className="h-3.5 w-3.5" />
      </ToolButton>
    </div>
  );
}
