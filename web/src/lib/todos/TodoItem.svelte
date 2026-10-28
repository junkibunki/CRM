<script module lang="ts">
	// built once: Intl formatters are expensive
	const noteDay = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' });
</script>

<script lang="ts">
	import { tick } from 'svelte';
	import CheckIcon from '@lucide/svelte/icons/check';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import XIcon from '@lucide/svelte/icons/x';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { changedFields } from '#lib/diff.js';
	import { cn } from '#lib/utils.js';
	import { typeLabel } from '#lib/activities/types.js';
	import { clock } from './clock.svelte';
	import { revealActivity } from '#lib/activities/reveal.js';
	import { dueGapNote, dueStatus, formatDone, formatDue, fromDueInput, toDueInput } from './due';
	import type { LeadTodoStore } from './lead.svelte';
	import { DUE_TEXT, DUE_TONE } from './NextTodoBadge.svelte';
	import { MAX_TITLE, type Todo } from './types';

	type Props = { store: LeadTodoStore; todo: Todo; ondelete: (todo: Todo) => void };
	let { store, todo, ondelete }: Props = $props();

	const status = $derived(todo.done ? null : dueStatus(todo, clock.now));
	const due = $derived(formatDue(todo, clock.now));
	const source = $derived(todo.source_activity ? todo.expand?.source_activity : undefined);

	// inline editing; values when editing started, so only what changed is saved
	let editing = $state<'title' | 'due' | null>(null);
	let title = $state('');
	let date = $state('');
	let time = $state('');
	let titleInput = $state<HTMLInputElement | null>(null);
	let dateInput = $state<HTMLInputElement | null>(null);
	let initial = { title: '', due: '', due_has_time: false };
	const gapNote = $derived(editing === 'due' ? dueGapNote(date, time) : '');

	async function edit(what: 'title' | 'due') {
		initial = { title: todo.title, due: todo.due, due_has_time: todo.due_has_time };
		title = todo.title;
		({ date, time } = toDueInput(todo));
		editing = what;
		await tick();
		(what === 'title' ? titleInput : dateInput)?.focus();
	}

	function saveTitle() {
		if (editing !== 'title') return;
		editing = null;
		const t = title.trim();
		if (!t || t.length > MAX_TITLE) return; // empty = cancel
		const changed = changedFields({ title: initial.title }, { title: t });
		if (Object.keys(changed).length) store.update(todo.id, changed);
	}

	function saveDue(e?: SubmitEvent) {
		e?.preventDefault();
		const next = fromDueInput(date, time);
		if (!next) return; // invalid: stay in edit mode
		editing = null;
		const changed = changedFields(
			{ due: initial.due, due_has_time: initial.due_has_time },
			{ due: next.due, due_has_time: next.due_has_time }
		);
		if (Object.keys(changed).length) store.update(todo.id, changed);
	}

	function onTitleKey(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			saveTitle();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			editing = null;
		}
	}

	function onDueKey(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			editing = null;
		}
	}

	// the note lives in the timeline on the same page; the timeline resets a filter that hides
	// it, then scrolls to it (activities/reveal.ts). Without a timeline the hash link stays.
	function showSource(e: MouseEvent) {
		if (todo.source_activity && revealActivity(todo.source_activity)) e.preventDefault();
	}
</script>

<li class="group flex items-start gap-2.5 py-2">
	<input
		type="checkbox"
		class="mt-0.5 size-4 shrink-0 cursor-pointer accent-primary"
		checked={todo.done}
		aria-label={todo.done ? `„${todo.title}“ wieder öffnen` : `„${todo.title}“ abhaken`}
		title={todo.done ? 'Wieder öffnen' : 'Abhaken'}
		onchange={() => store.toggle(todo.id)}
	/>

	<div class="min-w-0 flex-1">
		{#if editing === 'title'}
			<Input
				bind:ref={titleInput}
				bind:value={title}
				maxlength={MAX_TITLE}
				class="h-7"
				aria-label="Titel"
				onkeydown={onTitleKey}
				onblur={saveTitle}
			/>
		{:else}
			<button
				type="button"
				class={cn(
					'-mx-1 block max-w-full rounded px-1 text-left break-words hover:bg-muted/60',
					todo.done && 'text-muted-foreground line-through'
				)}
				title="Titel ändern"
				onclick={() => edit('title')}
			>
				{todo.title}
			</button>
		{/if}

		{#if editing === 'due'}
			<form class="mt-1 flex flex-wrap items-center gap-1.5" onsubmit={saveDue}>
				<Input
					bind:ref={dateInput}
					type="date"
					class="h-7 w-auto"
					aria-label="Fällig am"
					bind:value={date}
					required
					onkeydown={onDueKey}
				/>
				<Input type="time" class="h-7 w-auto" aria-label="Uhrzeit (optional)" bind:value={time} onkeydown={onDueKey} />
				<Button type="submit" size="icon-xs" aria-label="Fälligkeit speichern" title="Speichern">
					<CheckIcon />
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					aria-label="Abbrechen"
					title="Abbrechen"
					onclick={() => (editing = null)}
				>
					<XIcon />
				</Button>
				{#if gapNote}
					<p class="w-full text-xs text-amber-700 dark:text-amber-400" role="status">{gapNote}</p>
				{/if}
			</form>
		{:else}
			<div class="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
				<button
					type="button"
					class={cn('rounded px-1 font-medium tabular-nums hover:underline', status ? DUE_TONE[status] : '', (!status || status === 'future') && 'px-0')}
					title="Fälligkeit ändern"
					onclick={() => edit('due')}
				>
					{#if status}<span class="sr-only">{DUE_TEXT[status]}:</span>{/if}
					{due}
				</button>
				{#if todo.done && todo.done_at}
					<span>{formatDone(todo.done_at, clock.now)}</span>
				{/if}
				{#if source}
					<a
						href="#activity-{source.id}"
						class="truncate text-primary hover:underline"
						title={source.subject || typeLabel(source.type)}
						onclick={showSource}
					>
						aus {source.type === 'meeting' ? 'Meeting-Notiz' : 'Notiz'} vom {noteDay.format(
							new Date(source.occurred_at.replace(' ', 'T'))
						)}
					</a>
				{/if}
			</div>
		{/if}
	</div>

	<Button
		variant="ghost"
		size="icon-xs"
		class="opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
		aria-label="„{todo.title}“ löschen"
		title="Löschen"
		onclick={() => ondelete(todo)}
	>
		<Trash2Icon />
	</Button>
</li>
