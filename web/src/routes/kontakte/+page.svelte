<script lang="ts">
	import PlusIcon from '@lucide/svelte/icons/plus';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import { companies, companyName, contacts } from '#lib/collection.svelte.js';
	import ContactDialog from '#lib/crm/ContactDialog.svelte';
	import { contactName, type Contact } from '#lib/types.js';

	$effect(() => contacts.use());
	$effect(() => companies.use());

	let search = $state('');
	const q = $derived(search.trim().toLowerCase());
	const rows = $derived(
		q
			? contacts.list.filter((c) =>
					[contactName(c), companyName(c.company), c.position, c.email, c.phone].some((v) =>
						v?.toLowerCase().includes(q)
					)
				)
			: contacts.list
	);

	let open = $state(false);
	let selected = $state<Contact | null>(null);
	function edit(c: Contact | null) {
		selected = c;
		open = true;
	}
</script>

<svelte:head><title>Kontakte – CRM</title></svelte:head>

<div class="mx-auto max-w-6xl p-6">
	<PageHeader title="Kontakte" bind:search>
		{#snippet actions()}
			<Button onclick={() => edit(null)}><PlusIcon /> Neuer Kontakt</Button>
		{/snippet}
	</PageHeader>

	{#if contacts.error}<p class="mb-4 text-sm text-destructive">{contacts.error}</p>{/if}

	<div class="rounded-lg border bg-card">
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head>Name</Table.Head>
					<Table.Head>Unternehmen</Table.Head>
					<Table.Head>Position</Table.Head>
					<Table.Head>E-Mail</Table.Head>
					<Table.Head>Telefon</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each rows as c (c.id)}
					<Table.Row class="cursor-pointer" onclick={() => edit(c)}>
						<Table.Cell class="font-medium">{contactName(c)}</Table.Cell>
						<Table.Cell>{companyName(c.company)}</Table.Cell>
						<Table.Cell>{c.position}</Table.Cell>
						<Table.Cell>
							{#if c.email}
								<a
									href="mailto:{c.email}"
									class="text-primary hover:underline"
									onclick={(e) => e.stopPropagation()}>{c.email}</a
								>
							{/if}
						</Table.Cell>
						<Table.Cell>{c.phone}</Table.Cell>
					</Table.Row>
				{:else}
					<Table.Row>
						<Table.Cell colspan={5} class="py-8 text-center text-muted-foreground">
							{contacts.loaded ? (q ? 'Keine Treffer.' : 'Noch keine Kontakte.') : 'Lädt …'}
						</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	</div>
</div>

<ContactDialog contact={selected} bind:open />
