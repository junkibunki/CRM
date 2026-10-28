<script lang="ts">
	import type { RecordModel } from 'pocketbase';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import FileIcon from '@lucide/svelte/icons/file';
	import { errorMessage } from '#lib/pb.js';
	import { displayFileName, formatSize, isImageFile } from './format';
	import { downloadAttachment, fileSize, thumbUrl } from './files';
	import type { Activity } from './types';

	type Props = { activity: Activity; name: string };
	let { activity, name }: Props = $props();

	let box = $state<HTMLElement>();
	let size = $state<number | null>(null);
	let src = $state('');
	let error = $state('');
	let busy = $state(false);
	// steers loading only, not shown: plain variable (see CLAUDE.md)
	let retried = false;

	const image = $derived(isImageFile(name));
	// primitives only: a realtime edit of the activity (new object, same file) must not
	// fetch size and preview again
	const recId = $derived(activity.id);
	const collectionId = $derived(activity.collectionId);
	const collectionName = $derived(activity.collectionName);

	// Size and preview need a file token: fetch them only once the entry is on screen, so
	// a lead with hundreds of attachments doesn't fire hundreds of requests at once.
	$effect(() => {
		const el = box;
		if (!el) return;
		const rec = { id: recId, collectionId, collectionName } as RecordModel;
		const file = name;
		let stopped = false;
		const io = new IntersectionObserver((entries) => {
			if (!entries.some((e) => e.isIntersecting)) return;
			io.disconnect();
			fileSize(rec, file)
				.then((s) => !stopped && (size = s))
				.catch(() => {});
			if (isImageFile(file)) {
				thumbUrl(rec, file)
					.then((u) => !stopped && (src = u))
					.catch(() => {});
			}
		});
		io.observe(el);
		return () => {
			stopped = true;
			io.disconnect();
		};
	});

	// a token that expired before the image loaded: try once more with a fresh one
	async function onImageError() {
		if (retried) {
			src = '';
			return;
		}
		retried = true;
		src = await thumbUrl(activity, name, true).catch(() => '');
	}

	async function download() {
		busy = true;
		error = '';
		try {
			await downloadAttachment(activity, name);
		} catch (err) {
			error = errorMessage(err);
		} finally {
			busy = false;
		}
	}
</script>

<li bind:this={box} class="flex min-w-0 items-center gap-2 rounded-md border bg-background p-1.5 pr-1">
	{#if image && src}
		<button
			type="button"
			class="shrink-0 overflow-hidden rounded"
			title="Herunterladen"
			aria-label="{displayFileName(name)} herunterladen"
			onclick={download}
		>
			<img {src} alt="" class="size-12 object-cover" onerror={onImageError} />
		</button>
	{:else}
		<span class="flex size-12 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
			<FileIcon class="size-5" />
		</span>
	{/if}
	<div class="min-w-0 flex-1">
		<p class="truncate text-sm" title={displayFileName(name)}>{displayFileName(name)}</p>
		<p class="text-xs text-muted-foreground">
			{#if error}<span class="text-destructive">{error}</span>{:else if size !== null}{formatSize(size)}{:else}&nbsp;{/if}
		</p>
	</div>
	<button
		type="button"
		class="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
		aria-label="{displayFileName(name)} herunterladen"
		title="Herunterladen"
		disabled={busy}
		onclick={download}
	>
		<DownloadIcon class="size-4" />
	</button>
</li>
