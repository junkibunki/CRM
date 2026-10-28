<script lang="ts">
	import { untrack } from 'svelte';
	import type { Editor } from '@tiptap/core';
	import BoldIcon from '@lucide/svelte/icons/bold';
	import Heading2Icon from '@lucide/svelte/icons/heading-2';
	import ItalicIcon from '@lucide/svelte/icons/italic';
	import LinkIcon from '@lucide/svelte/icons/link';
	import ListIcon from '@lucide/svelte/icons/list';
	import ListOrderedIcon from '@lucide/svelte/icons/list-ordered';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import QuoteIcon from '@lucide/svelte/icons/quote';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { cn } from '#lib/utils.js';
	import { normalizeLink } from './format';
	import './activity-html.css';

	type Props = { value: string; label: string; invalid?: boolean };
	let { value = $bindable(''), label, invalid = false }: Props = $props();

	let element = $state<HTMLDivElement>();
	let editor = $state.raw<Editor | null>(null);
	let loadError = $state('');
	// bumped on every editor transaction, so the toolbar re-reads isActive()
	let tick = $state(0);
	let linkOpen = $state(false);
	let linkValue = $state('');
	let linkError = $state('');

	// Tiptap is loaded only here, when a form opens (keeps it out of the board bundle)
	$effect(() => {
		const el = element;
		if (!el) return;
		let ed: Editor | null = null;
		let stopped = false;
		import('./editor')
			.then(({ createEditor }) => {
				if (stopped) return;
				ed = createEditor({
					element: el,
					content: untrack(() => value),
					label,
					onUpdate: (html) => (value = html),
					onTransaction: () => tick++
				});
				editor = ed;
			})
			.catch((err) => (loadError = `Editor konnte nicht geladen werden: ${err?.message ?? err}`));
		return () => {
			stopped = true;
			ed?.destroy();
			editor = null;
		};
	});

	function active(name: string, attrs?: Record<string, unknown>) {
		void tick;
		return editor?.isActive(name, attrs) ?? false;
	}

	type Tool = { label: string; icon: typeof BoldIcon; name: string; attrs?: Record<string, unknown>; run: (e: Editor) => void };
	const tools: Tool[] = [
		{ label: 'Fett', icon: BoldIcon, name: 'bold', run: (e) => e.chain().focus().toggleBold().run() },
		{ label: 'Kursiv', icon: ItalicIcon, name: 'italic', run: (e) => e.chain().focus().toggleItalic().run() },
		{
			label: 'Überschrift',
			icon: Heading2Icon,
			name: 'heading',
			attrs: { level: 2 },
			run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run()
		},
		{ label: 'Aufzählung', icon: ListIcon, name: 'bulletList', run: (e) => e.chain().focus().toggleBulletList().run() },
		{
			label: 'Nummerierte Liste',
			icon: ListOrderedIcon,
			name: 'orderedList',
			run: (e) => e.chain().focus().toggleOrderedList().run()
		},
		{ label: 'Zitat', icon: QuoteIcon, name: 'blockquote', run: (e) => e.chain().focus().toggleBlockquote().run() }
	];

	function toggleLink() {
		if (!editor) return;
		linkOpen = !linkOpen;
		linkError = '';
		linkValue = linkOpen ? ((editor.getAttributes('link').href as string | undefined) ?? '') : '';
	}

	function applyLink(e?: Event) {
		e?.preventDefault();
		if (!editor) return;
		if (!linkValue.trim()) {
			editor.chain().focus().extendMarkRange('link').unsetLink().run();
			linkOpen = false;
			return;
		}
		const href = normalizeLink(linkValue);
		if (!href) {
			linkError = 'Nur Web-, E-Mail- und Telefon-Links sind erlaubt.';
			return;
		}
		const chain = editor.chain().focus().extendMarkRange('link');
		// no selection: insert the address itself as the link text
		if (editor.state.selection.empty && !editor.isActive('link')) {
			chain.insertContent({ type: 'text', text: linkValue.trim(), marks: [{ type: 'link', attrs: { href } }] }).run();
		} else chain.setLink({ href }).run();
		linkOpen = false;
	}

	function linkKeydown(e: KeyboardEvent) {
		// Enter must not submit the surrounding activity form
		if (e.key === 'Enter' && !(e.ctrlKey || e.metaKey)) applyLink(e);
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			linkOpen = false;
			editor?.commands.focus();
		}
	}
</script>

<div
	class={cn(
		'rounded-md border border-input bg-background focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30',
		invalid && 'border-destructive'
	)}
>
	<div class="flex flex-wrap items-center gap-0.5 border-b px-1 py-1" role="toolbar" aria-label="Formatierung">
		{#each tools as t (t.name)}
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				aria-label={t.label}
				title={t.label}
				aria-pressed={active(t.name, t.attrs)}
				class={active(t.name, t.attrs) ? 'bg-muted text-foreground' : 'text-muted-foreground'}
				disabled={!editor}
				onmousedown={(e: MouseEvent) => e.preventDefault()}
				onclick={() => editor && t.run(editor)}
			>
				<t.icon />
			</Button>
		{/each}
		<Button
			type="button"
			variant="ghost"
			size="icon-sm"
			aria-label="Link"
			title="Link"
			aria-pressed={active('link')}
			class={active('link') || linkOpen ? 'bg-muted text-foreground' : 'text-muted-foreground'}
			disabled={!editor}
			onmousedown={(e: MouseEvent) => e.preventDefault()}
			onclick={toggleLink}
		>
			<LinkIcon />
		</Button>
	</div>

	{#if linkOpen}
		<div class="flex flex-wrap items-center gap-2 border-b px-2 py-1.5">
			<!-- svelte-ignore a11y_autofocus -->
			<Input
				class="h-8 flex-1"
				placeholder="https://… oder name@firma.de (leer = Link entfernen)"
				aria-label="Link-Adresse"
				bind:value={linkValue}
				onkeydown={linkKeydown}
				autofocus
			/>
			<Button type="button" size="sm" onclick={() => applyLink()}>Übernehmen</Button>
			{#if linkError}<p class="w-full text-xs text-destructive">{linkError}</p>{/if}
		</div>
	{/if}

	<!-- Tiptap owns this element's children: keep Svelte content out of it -->
	<div bind:this={element} class="max-h-[50vh] overflow-y-auto text-sm"></div>
	{#if !editor && !loadError}
		<div class="flex min-h-40 items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
			<LoaderCircleIcon class="size-4 animate-spin" /> Editor wird geladen …
		</div>
	{/if}
	{#if loadError}<p class="px-3 py-2 text-sm text-destructive">{loadError}</p>{/if}
</div>
