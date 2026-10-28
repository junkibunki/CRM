<script lang="ts">
	import { untrack } from 'svelte';
	import ListTodoIcon from '@lucide/svelte/icons/list-todo';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
	import XIcon from '@lucide/svelte/icons/x';
	import { goto } from '$app/navigation';
	import { companies, contacts, users } from '#lib/collection.svelte.js';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import CompanyDialog from '#lib/crm/CompanyDialog.svelte';
	import ContactDialog from '#lib/crm/ContactDialog.svelte';
	import LeadDialog from '#lib/kanban/LeadDialog.svelte';
	import CompanyTile from '#lib/lead/CompanyTile.svelte';
	import ContactsTile from '#lib/lead/ContactsTile.svelte';
	import LeadHeader from '#lib/lead/LeadHeader.svelte';
	import PlaceholderTile from '#lib/lead/PlaceholderTile.svelte';
	import ActivityTimeline from '#lib/activities/ActivityTimeline.svelte';
	import { LeadStore } from '#lib/lead/lead.svelte.js';
	import type { Company, Contact } from '#lib/types.js';
	import type { PageProps } from './$types';

	let { params }: PageProps = $props();

	// tiles show contact, company and owner names; the dialogs pick from them
	$effect(() => companies.use());
	$effect(() => contacts.use());
	$effect(() => users.use());

	let store = $state<LeadStore | null>(null);

	// one store per lead id (the page component is reused when the id in the URL changes)
	$effect(() => {
		const id = params.id;
		return untrack(() => {
			const s = new LeadStore(id);
			store = s;
			return s.sync();
		});
	});

	// deleted here (header or dialog): back to the pipeline
	$effect(() => {
		if (store?.removed) goto('/leads');
	});

	let editOpen = $state(false);
	let confirmOpen = $state(false);
	let contactOpen = $state(false);
	let companyOpen = $state(false);
	let contact = $state<Contact | null>(null);
	let company = $state<Company | null>(null);

	function openContact(c: Contact) {
		contact = c;
		contactOpen = true;
	}

	function openCompany(c: Company) {
		company = c;
		companyOpen = true;
	}

	const lead = $derived(store?.lead ?? null);
</script>

<svelte:head><title>{lead?.title ?? 'Lead'} – CRM</title></svelte:head>

<div class="h-full overflow-y-auto">
	<div class="mx-auto flex max-w-7xl flex-col gap-4 p-4 sm:p-6">
		{#if store?.error}
			<div
				class="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
			>
				<span class="flex-1">{store.error}</span>
				<Button variant="ghost" size="icon-xs" aria-label="Schließen" onclick={() => store?.clearError()}>
					<XIcon />
				</Button>
			</div>
		{/if}

		{#if store?.deleted}
			<div class="flex flex-col items-start gap-3 rounded-lg border bg-card p-6 text-sm">
				<p>
					{lead
						? `Der Lead „${lead.title}“ wurde gelöscht.`
						: 'Diesen Lead gibt es nicht (mehr).'}
				</p>
				<Button href="/leads" variant="outline" size="sm">Zur Pipeline</Button>
			</div>
		{:else if !store || store.loading}
			<p class="text-sm text-muted-foreground">Lädt …</p>
		{:else if lead}
			<LeadHeader
				{store}
				{lead}
				onedit={() => (editOpen = true)}
				ondelete={() => (confirmOpen = true)}
			/>

			<div class="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
				<ActivityTimeline leadId={lead.id} />
				<!-- own column: as grid rows next to the (tall) timeline the tiles would spread out;
				     on phones first, so contacts and company aren't buried below many activities -->
				<aside class="order-first flex flex-col gap-4 lg:order-none">
					<ContactsTile {lead} onopen={openContact} />
					<CompanyTile companyId={lead.company} onopen={openCompany} />
					<!-- F7: to-dos of this lead -->
					<PlaceholderTile icon={ListTodoIcon} title="To-Dos" text="To-Dos folgen." />
					<!-- F12: requirements of the current stage -->
					<PlaceholderTile icon={ShieldCheckIcon} title="Bedingungen" text="Bedingungen der Phase folgen." />
				</aside>
			</div>
		{:else}
			<!-- first load failed (e.g. offline); liveSync loads again after the reconnect -->
			<div>
				<Button href="/leads" variant="outline" size="sm">Zurück zur Pipeline</Button>
			</div>
		{/if}
	</div>
</div>

{#if store && lead}
	<!-- LeadDialog edits through the store it gets; LeadStore offers the same calls
	     (LeadWriter), see lib/lead/lead.svelte.ts -->
	<LeadDialog
		{store}
		{lead}
		column={store.stage ?? null}
		bind:open={editOpen}
	/>
	<ConfirmDialog
		bind:open={confirmOpen}
		title="Lead löschen?"
		description="„{lead.title}“ wird endgültig gelöscht."
		onconfirm={() => store?.deleteLead(lead.id)}
	/>
{/if}

<ContactDialog contact={contact} bind:open={contactOpen} />
<CompanyDialog company={company} bind:open={companyOpen} />
