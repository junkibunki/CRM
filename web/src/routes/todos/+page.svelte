<script lang="ts">
	import XIcon from '@lucide/svelte/icons/x';
	import { page } from '$app/state';
	import { auth } from '#lib/auth.svelte.js';
	import { companies, companyName, userLabel, users } from '#lib/collection.svelte.js';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { clock } from '#lib/todos/clock.svelte.js';
	import { GROUPS, groupTodos, matchesSearch } from '#lib/todos/groups.js';
	import { myTodos } from '#lib/todos/mine.svelte.js';
	import MyTodoItem from '#lib/todos/MyTodoItem.svelte';
	import type { OpenTodo } from '#lib/todos/types.js';

	// the layout's counter keeps the source running too; this is the same one
	$effect(() => myTodos.use());
	$effect(() => companies.use());
	$effect(() => users.use());

	/** "?alle" shows the to-dos of all users (a link, so back/forward and reload keep it) */
	const all = $derived(page.url.searchParams.has('alle'));

	let search = $state('');
	const q = $derived(search.trim().toLowerCase());

	const visible = $derived.by(() => {
		const list = myTodos.list(all ? null : (auth.user?.id ?? ''));
		if (!q) return list;
		const names = { company: companyName, owner: all ? userLabel : undefined };
		return list.filter((t) => matchesSearch(t, myTodos.lead(t.lead), q, names));
	});
	const groups = $derived(groupTodos(visible, clock.now));

	// undo after ticking off (the to-do leaves the list at once)
	let undo = $state<OpenTodo | null>(null);
	let undoTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => () => clearTimeout(undoTimer));

	// the undo notice only once it is really saved (not on failure, not if it was gone)
	async function complete(todo: OpenTodo) {
		if (!(await myTodos.complete(todo.id))) return;
		undo = todo;
		clearTimeout(undoTimer);
		undoTimer = setTimeout(() => (undo = null), 6000);
	}

	function reopen() {
		if (!undo) return;
		myTodos.reopen(undo);
		undo = null;
		clearTimeout(undoTimer);
	}

	const tab =
		'rounded-md px-3 py-1 text-sm text-muted-foreground hover:text-foreground aria-[current=page]:bg-background aria-[current=page]:font-medium aria-[current=page]:text-foreground aria-[current=page]:shadow-sm';
</script>

<svelte:head><title>To-Dos – CRM</title></svelte:head>

<div class="mx-auto max-w-3xl p-4 sm:p-6">
	<PageHeader title={all ? 'Alle To-Dos' : 'Meine To-Dos'} bind:search>
		{#snippet actions()}
			<nav class="inline-flex rounded-lg bg-muted p-0.5" aria-label="Wessen To-Dos">
				<a href="/todos" class={tab} aria-current={all ? undefined : 'page'}>Meine</a>
				<a href="/todos?alle" class={tab} aria-current={all ? 'page' : undefined}>Alle Nutzer</a>
			</nav>
		{/snippet}
	</PageHeader>

	{#if myTodos.error}
		<div
			class="mb-4 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
			role="alert"
		>
			<span class="flex-1">{myTodos.error}</span>
			<Button variant="ghost" size="icon-xs" aria-label="Meldung schließen" onclick={() => myTodos.clearError()}>
				<XIcon />
			</Button>
		</div>
	{/if}

	{#if !myTodos.loaded}
		<p class="text-sm text-muted-foreground">Lädt …</p>
	{:else if visible.length === 0}
		<p class="rounded-lg border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
			{q
				? 'Keine To-Dos passen zur Suche.'
				: all
					? 'Keine offenen To-Dos.'
					: 'Keine offenen To-Dos bei deinen Leads.'}
		</p>
	{:else}
		<div class="flex flex-col gap-5">
			{#each GROUPS as g (g.key)}
				{#if groups[g.key].length}
					<section aria-labelledby="group-{g.key}">
						<h2
							id="group-{g.key}"
							class={g.key === 'overdue'
								? 'mb-1.5 text-sm font-semibold text-destructive'
								: 'mb-1.5 text-sm font-semibold text-muted-foreground'}
						>
							{g.label}
							<span class="font-normal tabular-nums">({groups[g.key].length})</span>
						</h2>
						<ul class="divide-y rounded-lg border bg-card">
							{#each groups[g.key] as todo (todo.id)}
								<MyTodoItem {todo} lead={myTodos.lead(todo.lead)} showOwner={all} oncomplete={complete} />
							{/each}
						</ul>
					</section>
				{/if}
			{/each}
		</div>
	{/if}
</div>

{#if undo}
	<div
		class="fixed bottom-4 left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-lg border bg-card px-4 py-2 text-sm shadow-lg"
		role="status"
	>
		<span class="min-w-0 truncate">„{undo.title}“ erledigt.</span>
		<Button variant="outline" size="sm" onclick={reopen}>Rückgängig</Button>
	</div>
{/if}
