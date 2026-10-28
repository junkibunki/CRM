// Tiptap setup. Imported only dynamically from RichTextEditor.svelte, so the editor stays
// out of every bundle except the one of the opened activity form.
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';

export function createEditor(opts: {
	element: HTMLElement;
	content: string;
	label: string;
	onUpdate: (html: string) => void;
	/** after every change of content or selection (toolbar state) */
	onTransaction: () => void;
}): Editor {
	return new Editor({
		element: opts.element,
		content: opts.content,
		extensions: [
			StarterKit.configure({
				heading: { levels: [2, 3] },
				link: {
					openOnClick: false,
					autolink: true,
					defaultProtocol: 'https',
					protocols: ['mailto', 'tel'],
					HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' }
				}
			})
		],
		editorProps: {
			attributes: {
				class: 'activity-html min-h-40 px-3 py-2 outline-none',
				role: 'textbox',
				'aria-multiline': 'true',
				'aria-label': opts.label
			}
		},
		onUpdate: ({ editor }) => opts.onUpdate(editor.isEmpty ? '' : editor.getHTML()),
		onTransaction: () => opts.onTransaction()
	});
}
