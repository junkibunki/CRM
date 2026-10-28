// The app's dialog parts: shadcn-svelte's (components/ui/dialog, CLI output) with a German
// close button in Content. Import dialogs from here, not from components/ui/dialog.
export {
	Close,
	Description,
	Footer,
	Header,
	Overlay,
	Portal,
	Root,
	Title,
	Trigger
} from '#lib/components/ui/dialog/index.js';
export { default as Content } from './DialogContent.svelte';
