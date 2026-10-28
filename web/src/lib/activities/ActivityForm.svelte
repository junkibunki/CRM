<script lang="ts">
	import { untrack } from 'svelte';
	import PaperclipIcon from '@lucide/svelte/icons/paperclip';
	import XIcon from '@lucide/svelte/icons/x';
	import { contactLabel, contacts } from '#lib/collection.svelte.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/dialog/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import { errorMessage } from '#lib/pb.js';
	import { cn } from '#lib/utils.js';
	import type { ActivityStore } from './activities.svelte';
	import { TYPE_STYLE } from './ActivityItem.svelte';
	import { attachmentName, formatSize, fromDateTimeInput, toDateTimeInput, toPbDate } from './format';
	import RichTextEditor from './RichTextEditor.svelte';
	import { isEmptyHtml } from './sanitize';
	import {
		ACTIVITY_TYPES,
		MAX_ATTACHMENT_SIZE,
		MAX_ATTACHMENTS,
		MAX_BODY_SIZE,
		type Activity,
		type ActivityData,
		type ActivityType
	} from './types';

	type Props = {
		store: ActivityStore;
		/** activity to edit, or null for a new one */
		activity: Activity | null;
		open: boolean;
	};
	let { store, activity, open = $bindable() }: Props = $props();

	let form = $state({ type: 'note' as ActivityType, subject: '', body: '', occurred_at: '', contacts: [] as string[] });
	let files = $state<File[]>([]); // new uploads
	let removed = $state<string[]>([]); // stored names to delete
	let error = $state('');
	let busy = $state(false);
	let dragging = $state(false);
	let fileInput = $state<HTMLInputElement>();
	// values when the form opened; only what differs is saved (changedFields)
	let initial: ActivityData | null = null;

	// (re)fill only when the dialog opens, so realtime updates don't overwrite typing
	$effect(() => {
		if (!open) return;
		const a = activity;
		untrack(() => {
			form = a
				? {
						type: a.type,
						subject: a.subject,
						body: a.body,
						occurred_at: toDateTimeInput(a.occurred_at),
						contacts: [...a.contacts]
					}
				: { type: 'note', subject: '', body: '', occurred_at: toDateTimeInput(toPbDate(new Date())), contacts: [] };
			initial = a ? toData() : null;
			files = [];
			removed = [];
			error = '';
			busy = false;
		});
	});

	function toData(): ActivityData {
		return {
			type: form.type,
			subject: form.subject.trim(),
			body: form.body,
			occurred_at: fromDateTimeInput(form.occurred_at),
			contacts: [...form.contacts]
		};
	}

	// the lead's contacts, plus any already chosen (e.g. removed from the lead since)
	const contactOptions = $derived.by(() => {
		const ids = new Set([...(store.lead?.contacts ?? []), ...form.contacts]);
		return contacts.list.filter((c) => ids.has(c.id));
	});

	const kept = $derived((activity?.attachments ?? []).filter((n) => !removed.includes(n)));

	function addFiles(list: FileList | File[] | null | undefined) {
		if (!list) return;
		error = '';
		for (const f of Array.from(list)) {
			if (f.size > MAX_ATTACHMENT_SIZE) {
				error = `„${f.name}“ ist größer als ${formatSize(MAX_ATTACHMENT_SIZE)}.`;
				continue;
			}
			if (kept.length + files.length >= MAX_ATTACHMENTS) {
				error = `Höchstens ${MAX_ATTACHMENTS} Anhänge je Aktivität.`;
				break;
			}
			files.push(f);
		}
	}

	function validate(d: ActivityData) {
		if (isEmptyHtml(d.body)) return 'Bitte einen Inhalt eingeben.';
		if (new Blob([d.body]).size > MAX_BODY_SIZE) return 'Der Inhalt ist zu groß (höchstens 1 MB).';
		if (!d.occurred_at) return 'Bitte einen gültigen Zeitpunkt angeben.';
		return '';
	}

	async function save(e?: Event) {
		e?.preventDefault();
		if (busy) return;
		const data = toData();
		error = validate(data);
		if (error) return;
		busy = true;
		try {
			if (activity && initial) {
				await store.update(activity.id, initial, data, [...files], [...removed]);
			} else {
				await store.create(data, [...files]);
			}
			open = false;
		} catch (err) {
			error = errorMessage(err);
		} finally {
			busy = false;
		}
	}

	// Ctrl+Enter saves. Capture phase: the editor would otherwise insert a line break.
	function keydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			e.stopPropagation();
			save();
		}
	}

	const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');

	// files dropped anywhere on the form (also on the editor) become attachments
	function dragover(e: DragEvent) {
		if (!hasFiles(e)) return;
		e.preventDefault();
		e.stopPropagation();
		dragging = true;
	}
	function drop(e: DragEvent) {
		if (!hasFiles(e)) return;
		e.preventDefault();
		e.stopPropagation();
		dragging = false;
		addFiles(e.dataTransfer?.files);
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[95vh] overflow-y-auto sm:max-w-2xl">
		<form
			class={cn('relative flex flex-col gap-4', dragging && 'rounded-md outline-2 outline-offset-4 outline-primary outline-dashed')}
			onsubmit={save}
			onkeydowncapture={keydown}
			ondragovercapture={dragover}
			ondragleave={(e) => {
				if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) dragging = false;
			}}
			ondropcapture={drop}
		>
			<Dialog.Header>
				<Dialog.Title>{activity ? 'Aktivität bearbeiten' : 'Neue Aktivität'}</Dialog.Title>
				<Dialog.Description>Strg+Enter speichert. Dateien einfach hierher ziehen.</Dialog.Description>
			</Dialog.Header>

			<div class="grid gap-1.5">
				<Label id="activity-type-label">Art</Label>
				<div class="flex flex-wrap gap-1.5" role="radiogroup" aria-labelledby="activity-type-label">
					{#each ACTIVITY_TYPES as t (t.key)}
						{@const Icon = TYPE_STYLE[t.key].icon}
						<Button
							type="button"
							size="sm"
							variant={form.type === t.key ? 'default' : 'outline'}
							role="radio"
							aria-checked={form.type === t.key}
							onclick={() => (form.type = t.key)}
						>
							<Icon /> {t.label}
						</Button>
					{/each}
				</div>
			</div>

			<div class="grid gap-4 sm:grid-cols-[1fr_auto]">
				<div class="grid gap-1.5">
					<Label for="activity-subject">{form.type === 'meeting' ? 'Titel' : 'Betreff'}</Label>
					<Input id="activity-subject" bind:value={form.subject} maxlength={500} placeholder="optional" />
				</div>
				<div class="grid gap-1.5">
					<Label for="activity-when">Zeitpunkt</Label>
					<Input id="activity-when" type="datetime-local" bind:value={form.occurred_at} required />
				</div>
			</div>

			<div class="grid gap-1.5">
				<Label>Inhalt</Label>
				<RichTextEditor bind:value={form.body} label="Inhalt" />
			</div>

			<div class="grid gap-1.5">
				<Label>Kontakte</Label>
				<Select.Root type="multiple" bind:value={form.contacts}>
					<Select.Trigger class="w-full">
						<span class="truncate">{form.contacts.map(contactLabel).join(', ') || 'Keine ausgewählt'}</span>
					</Select.Trigger>
					<Select.Content>
						{#each contactOptions as c (c.id)}
							<Select.Item value={c.id} label={contactLabel(c.id)} />
						{:else}
							<p class="px-2 py-1.5 text-sm text-muted-foreground">Der Lead hat keine Kontakte.</p>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>

			<div class="grid gap-1.5">
				<div class="flex items-center justify-between">
					<Label>Anhänge</Label>
					<Button type="button" variant="ghost" size="xs" onclick={() => fileInput?.click()}>
						<PaperclipIcon /> Dateien wählen
					</Button>
				</div>
				<input
					bind:this={fileInput}
					type="file"
					multiple
					class="hidden"
					onchange={(e) => {
						addFiles(e.currentTarget.files);
						e.currentTarget.value = '';
					}}
				/>
				{#if kept.length || files.length}
					<ul class="grid gap-1 text-sm">
						{#each kept as name (name)}
							<li class="flex items-center gap-2 rounded-md border px-2 py-1">
								<PaperclipIcon class="size-3.5 shrink-0 text-muted-foreground" />
								<span class="min-w-0 flex-1 truncate">{attachmentName(activity?.attachment_names, name)}</span>
								<Button
									type="button"
									variant="ghost"
									size="icon-xs"
									aria-label="{attachmentName(activity?.attachment_names, name)} entfernen"
									onclick={() => removed.push(name)}
								>
									<XIcon />
								</Button>
							</li>
						{/each}
						{#each files as f, i (f)}
							<li class="flex items-center gap-2 rounded-md border border-dashed px-2 py-1">
								<PaperclipIcon class="size-3.5 shrink-0 text-muted-foreground" />
								<span class="min-w-0 flex-1 truncate">{f.name}</span>
								<span class="text-xs text-muted-foreground">{formatSize(f.size)} · neu</span>
								<Button
									type="button"
									variant="ghost"
									size="icon-xs"
									aria-label="{f.name} entfernen"
									onclick={() => files.splice(i, 1)}
								>
									<XIcon />
								</Button>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="rounded-md border border-dashed px-3 py-3 text-center text-sm text-muted-foreground">
						Dateien hierher ziehen oder auswählen (bis {MAX_ATTACHMENTS}, je {formatSize(MAX_ATTACHMENT_SIZE)}).
					</p>
				{/if}
				{#if removed.length}
					<p class="text-xs text-muted-foreground">
						{removed.length === 1 ? '1 Anhang wird' : `${removed.length} Anhänge werden`} beim Speichern entfernt.
						<button type="button" class="font-medium text-primary hover:underline" onclick={() => (removed = [])}>Rückgängig</button>
					</p>
				{/if}
			</div>

			{#if error}<p class="text-sm text-destructive" role="alert">{error}</p>{/if}

			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (open = false)}>Abbrechen</Button>
				<Button type="submit" disabled={busy}>
					{busy ? 'Speichert …' : activity ? 'Speichern' : 'Anlegen'}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
