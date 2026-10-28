<script lang="ts">
	import { untrack } from 'svelte';
	import XIcon from '@lucide/svelte/icons/x';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/dialog/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { errorMessage } from '#lib/pb.js';
	import { dueGapNote, fromDueInput, QUICK_PICKS, quickDay } from './due';
	import { MAX_TITLE, type TodoData } from './types';

	/**
	 * New to-do: title, date (quick picks today / tomorrow / next week) and optional time.
	 * Waits for the server and stays open with a message if saving fails.
	 */
	type Props = {
		open: boolean;
		/** pre-filled title, e.g. the selected text of a note */
		initialTitle?: string;
		/** shown under the heading, e.g. which note the to-do is made from */
		description?: string;
		save: (data: TodoData) => Promise<unknown>;
	};
	let { open = $bindable(), initialTitle = '', description = '', save }: Props = $props();

	let title = $state('');
	let date = $state('');
	let time = $state('');
	let error = $state('');
	let saving = $state(false);
	// e.g. 02:30 on the day summer time starts: saved as 03:30, say so before saving
	const gapNote = $derived(dueGapNote(date, time));

	$effect(() => {
		if (!open) return;
		untrack(() => {
			title = initialTitle;
			date = quickDay('today', new Date());
			time = '';
			error = '';
			saving = false;
		});
	});

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (saving) return;
		const t = title.trim();
		if (!t) return void (error = 'Bitte einen Titel eingeben.');
		if (t.length > MAX_TITLE) return void (error = `Der Titel darf höchstens ${MAX_TITLE} Zeichen haben.`);
		const due = fromDueInput(date, time);
		if (!due) return void (error = 'Bitte ein gültiges Datum (und ggf. eine Uhrzeit) angeben.');
		saving = true;
		error = '';
		try {
			await save({ title: t, ...due });
			open = false;
		} catch (err) {
			error = errorMessage(err);
		} finally {
			saving = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		<form class="flex flex-col gap-4" onsubmit={submit}>
			<Dialog.Header>
				<Dialog.Title>Neues To-Do</Dialog.Title>
				{#if description}<Dialog.Description>{description}</Dialog.Description>{/if}
			</Dialog.Header>

			<div class="grid gap-1.5">
				<Label for="todo-title">Was ist zu tun?</Label>
				<Input id="todo-title" bind:value={title} required maxlength={MAX_TITLE} autocomplete="off" />
			</div>

			<div class="grid gap-1.5">
				<Label for="todo-date">Fällig am</Label>
				<div class="flex flex-wrap gap-1">
					{#each QUICK_PICKS as q (q.key)}
						{@const day = quickDay(q.key, new Date())}
						<Button
							type="button"
							size="xs"
							variant={date === day ? 'secondary' : 'outline'}
							aria-pressed={date === day}
							onclick={() => (date = day)}
						>
							{q.label}
						</Button>
					{/each}
				</div>
				<div class="flex items-center gap-2">
					<Input id="todo-date" type="date" class="w-auto" bind:value={date} required />
					<Input
						id="todo-time"
						type="time"
						class="w-auto"
						aria-label="Uhrzeit (optional)"
						title="Uhrzeit (optional)"
						bind:value={time}
					/>
					{#if time}
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							aria-label="Ohne Uhrzeit"
							title="Ohne Uhrzeit"
							onclick={() => (time = '')}
						>
							<XIcon />
						</Button>
					{/if}
				</div>
				{#if gapNote}
					<p class="text-xs text-amber-700 dark:text-amber-400" role="status">{gapNote}</p>
				{:else}
					<p class="text-xs text-muted-foreground">Uhrzeit optional – ohne Uhrzeit gilt der ganze Tag.</p>
				{/if}
			</div>

			{#if error}
				<p class="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{error}</p>
			{/if}

			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (open = false)}>Abbrechen</Button>
				<Button type="submit" disabled={saving}>{saving ? 'Speichert …' : 'Anlegen'}</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
