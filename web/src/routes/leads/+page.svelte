<script lang="ts">
	import { untrack } from 'svelte';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import XIcon from '@lucide/svelte/icons/x';
	import { BoardStore } from '#lib/board.svelte.js';
	import { companies, contacts, users } from '#lib/collection.svelte.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import BoardSettingsDialog from '#lib/kanban/BoardSettingsDialog.svelte';
	import KanbanBoard from '#lib/kanban/KanbanBoard.svelte';
	import { liveSync } from '#lib/live.js';
	import { errorMessage, pb } from '#lib/pb.js';
	import { LastActivityStore } from '#lib/last-activity/last.svelte.js';
	import { PipelineTodoStore } from '#lib/todos/pipeline.svelte.js';
	import { GateStore } from '#lib/gates/gates.svelte.js';
	import type { Board } from '#lib/types.js';

	// cards show company, contact and owner names, the lead dialog picks from them
	$effect(() => companies.use());
	$effect(() => contacts.use());
	$effect(() => users.use());

	let store = $state<BoardStore | null>(null);
	let todos = $state<PipelineTodoStore | null>(null);
	let activity = $state<LastActivityStore | null>(null);
	let gates = $state<GateStore | null>(null);
	let error = $state('');
	let settingsOpen = $state(false);
	let attempt = $state(0); // bumped by "Erneut versuchen"

	// There is exactly one pipeline (seeded by the migration). Looked up via liveSync, so a
	// failed lookup (opened offline, server restarting) is retried after the reconnect.
	$effect(() => {
		void attempt;
		let teardown: (() => void) | undefined;
		const stop = untrack(() => {
			return liveSync({
				subscribe: () => [],
				fetch: () => pb.collection('boards').getFirstListItem<Board>('', { sort: 'created' }),
				apply: (board) => {
					if (store?.id === board.id && !store.deleted) return;
					teardown?.();
					const s = new BoardStore(board.id);
					// all open to-dos of the pipeline in one query (next to-do per card, F7)
					const t = new PipelineTodoStore(board.id);
					// latest activity per lead, also one query (F4)
					const a = new LastActivityStore(board.id);
					// stage requirements + the checks of all its leads, one query each (F12)
					const g = GateStore.forBoard(board.id);
					store = s;
					todos = t;
					activity = a;
					gates = g;
					error = '';
					const stops = [s.sync(), t.sync(), a.sync(), g.sync()];
					teardown = () => stops.forEach((stop) => stop());
				},
				onError: (err) => (error = errorMessage(err))
			});
		});
		return () => {
			stop();
			teardown?.();
		};
	});

	function retry() {
		error = '';
		store = null;
		todos = null;
		activity = null;
		gates = null;
		attempt++;
	}
</script>

<svelte:head><title>Leads – CRM</title></svelte:head>

<div class="flex h-full flex-col">
	<div class="flex items-center gap-2 px-4 pt-3">
		<h1 class="text-lg font-semibold">{store?.board?.name ?? 'Leads'}</h1>
		{#if store?.board}
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label="Pipeline-Einstellungen"
				onclick={() => (settingsOpen = true)}
			>
				<SettingsIcon />
			</Button>
		{/if}
	</div>

	{#if error || store?.error || todos?.error || activity?.error || gates?.error}
		<div
			class="mx-4 mt-2 flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
		>
			<span class="flex-1">
				{error ||
					store?.error ||
					(todos?.error
						? `To-Dos: ${todos.error}`
						: activity?.error
							? `Letzte Aktivitäten: ${activity.error}`
							: gates?.error)}
			</span>
			<Button
				variant="ghost"
				size="icon-xs"
				aria-label="Schließen"
				onclick={() => {
					error = '';
					store?.clearError();
					todos?.clearError();
					if (activity) activity.error = '';
					gates?.clearError();
				}}
			>
				<XIcon />
			</Button>
		</div>
	{/if}

	{#if store?.deleted || (!store && error)}
		<div class="flex items-center gap-3 p-4 text-sm text-muted-foreground">
			{store?.deleted ? 'Die Pipeline wurde nicht gefunden.' : 'Die Pipeline konnte nicht geladen werden.'}
			<Button variant="outline" size="sm" onclick={retry}>Erneut versuchen</Button>
		</div>
	{:else if !store || store.loading}
		<p class="p-4 text-sm text-muted-foreground">Lädt …</p>
	{:else if store.board}
		<div class="min-h-0 flex-1">
			<KanbanBoard
				{store}
				todos={todos ?? undefined}
				activity={activity ?? undefined}
				gates={gates ?? undefined}
			/>
		</div>
	{/if}
</div>

{#if store}
	<BoardSettingsDialog {store} bind:open={settingsOpen} />
{/if}
