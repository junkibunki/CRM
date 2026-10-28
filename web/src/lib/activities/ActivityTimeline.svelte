<script lang="ts">
	import { untrack } from 'svelte';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import XIcon from '@lucide/svelte/icons/x';
	import { contacts, users } from '#lib/collection.svelte.js';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { ActivityStore } from './activities.svelte';
	import ActivityForm from './ActivityForm.svelte';
	import ActivityItem from './ActivityItem.svelte';
	import { groupByDay } from './format';
	import { ACTIVITY_FILTERS, typeLabel, type Activity, type ActivityFilter } from './types';

	/** Interface for the lead page (F2): all activities of one lead, live. */
	let { leadId }: { leadId: string } = $props();

	// names of contacts (participants) and authors
	$effect(() => contacts.use());
	$effect(() => users.use());

	let store = $state<ActivityStore | null>(null);
	$effect(() => {
		const s = new ActivityStore(leadId);
		store = s;
		return untrack(() => s.sync());
	});

	let filter = $state<ActivityFilter>('all');
	let formOpen = $state(false);
	let editing = $state<Activity | null>(null);
	let confirmOpen = $state(false);
	let deleting = $state<Activity | null>(null);

	const visible = $derived(store ? store.visible(filter) : []);
	const groups = $derived(groupByDay(visible));

	function create() {
		editing = null;
		formOpen = true;
	}
	function edit(a: Activity) {
		editing = a;
		formOpen = true;
	}
	function askDelete(a: Activity) {
		deleting = a;
		confirmOpen = true;
	}
	function remove() {
		if (deleting && store) store.remove(deleting.id);
	}
</script>

<section class="flex flex-col gap-3 rounded-lg border bg-card p-4 text-card-foreground" aria-labelledby="activities-title">
	<div class="flex flex-wrap items-center gap-2">
		<h2 id="activities-title" class="text-base font-semibold">Aktivitäten</h2>
		{#if store?.loaded && !store.gone}
			<span class="text-sm text-muted-foreground">{store.list.length}</span>
		{/if}
		<Button class="ml-auto" size="sm" disabled={!store?.loaded || store.gone} onclick={create}>
			<PlusIcon /> Neue Aktivität
		</Button>
	</div>

	<div class="flex flex-wrap gap-1" role="tablist" aria-label="Nach Art filtern">
		{#each ACTIVITY_FILTERS as f (f.key)}
			<Button
				size="xs"
				variant={filter === f.key ? 'secondary' : 'ghost'}
				class={filter === f.key ? 'border-border' : 'text-muted-foreground'}
				role="tab"
				aria-selected={filter === f.key}
				onclick={() => (filter = f.key)}
			>
				{f.label}
			</Button>
		{/each}
	</div>

	{#if store?.error}
		<div class="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
			<span class="flex-1">{store.error}</span>
			<Button variant="ghost" size="icon-xs" aria-label="Meldung schließen" onclick={() => store && (store.error = '')}>
				<XIcon />
			</Button>
		</div>
	{/if}

	{#if !store?.loaded}
		<p class="py-6 text-center text-sm text-muted-foreground">Aktivitäten werden geladen …</p>
	{:else if store.gone}
		<p class="py-6 text-center text-sm text-muted-foreground">Dieser Lead wurde gelöscht.</p>
	{:else if groups.length === 0}
		<p class="py-6 text-center text-sm text-muted-foreground">
			{filter === 'all' ? 'Noch keine Aktivitäten. Lege die erste an.' : 'Keine Aktivitäten dieser Art.'}
		</p>
	{:else}
		<ol class="flex flex-col gap-4">
			{#each groups as g (g.key)}
				<li>
					<h3 class="sticky top-0 z-10 bg-card/95 py-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase backdrop-blur">
						{g.label}
					</h3>
					<div class="divide-y">
						{#each g.items as a (a.id)}
							<ActivityItem activity={a} onedit={edit} ondelete={askDelete} />
						{/each}
					</div>
				</li>
			{/each}
		</ol>
	{/if}
</section>

{#if store}
	<ActivityForm {store} activity={editing} bind:open={formOpen} />
{/if}

<ConfirmDialog
	bind:open={confirmOpen}
	title="Aktivität löschen?"
	description="„{deleting?.subject || (deleting ? typeLabel(deleting.type) : '')}“ wird mit allen Anhängen endgültig gelöscht."
	onconfirm={remove}
/>
