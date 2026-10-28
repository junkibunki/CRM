<script lang="ts">
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import ListTodoIcon from '@lucide/svelte/icons/list-todo';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import XIcon from '@lucide/svelte/icons/x';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { useLeadTodos, type LeadTodoStore } from './lead.svelte';
	import TodoForm from './TodoForm.svelte';
	import TodoItem from './TodoItem.svelte';
	import type { Todo } from './types';

	/** Interface for the lead page (F2): the to-dos of one lead, live. */
	let { leadId }: { leadId: string } = $props();

	let store = $state<LeadTodoStore | null>(null);
	$effect(() => {
		const h = useLeadTodos(leadId);
		store = h.store;
		return h.release;
	});

	let formOpen = $state(false);
	let showDone = $state(false);
	let confirmOpen = $state(false);
	let deleting = $state<Todo | null>(null);

	function askDelete(t: Todo) {
		deleting = t;
		confirmOpen = true;
	}
</script>

<Card.Root size="sm">
	<Card.Header>
		<Card.Title class="flex items-center gap-2">
			<ListTodoIcon class="size-4 text-muted-foreground" /> To-Dos
			{#if store?.loaded}
				<span class="text-sm font-normal text-muted-foreground">{store.open.length}</span>
			{/if}
		</Card.Title>
		<Card.Action>
			<Button size="xs" variant="outline" disabled={!store?.loaded} onclick={() => (formOpen = true)}>
				<PlusIcon /> To-Do
			</Button>
		</Card.Action>
	</Card.Header>
	<Card.Content class="flex flex-col gap-1">
		{#if store?.error}
			<div class="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-destructive" role="alert">
				<span class="flex-1">{store.error}</span>
				<Button variant="ghost" size="icon-xs" aria-label="Meldung schließen" onclick={() => store?.clearError()}>
					<XIcon />
				</Button>
			</div>
		{/if}

		{#if !store?.loaded}
			<p class="text-muted-foreground">Lädt …</p>
		{:else}
			{#if store.open.length}
				<ul class="-my-2 divide-y" aria-label="Offene To-Dos">
					{#each store.open as t (t.id)}
						<TodoItem {store} todo={t} ondelete={askDelete} />
					{/each}
				</ul>
			{:else}
				<p class="text-muted-foreground">Kein offenes To-Do.</p>
			{/if}

			{#if store.done.length}
				<button
					type="button"
					class="mt-2 flex items-center gap-1 self-start text-xs font-medium text-muted-foreground hover:text-foreground"
					aria-expanded={showDone}
					onclick={() => (showDone = !showDone)}
				>
					<ChevronRightIcon class="size-3.5 transition-transform {showDone ? 'rotate-90' : ''}" />
					Erledigt ({store.done.length})
				</button>
				{#if showDone}
					<ul class="divide-y" aria-label="Erledigte To-Dos">
						{#each store.done as t (t.id)}
							<TodoItem {store} todo={t} ondelete={askDelete} />
						{/each}
					</ul>
				{/if}
			{/if}
		{/if}
	</Card.Content>
</Card.Root>

{#if store}
	{@const s = store}
	<TodoForm bind:open={formOpen} save={(data) => s.create(data)} />
{/if}

<ConfirmDialog
	bind:open={confirmOpen}
	title="To-Do löschen?"
	description="„{deleting?.title ?? ''}“ wird endgültig gelöscht."
	onconfirm={() => deleting && store?.delete(deleting.id)}
/>
