<script lang="ts">
	import PlusIcon from '@lucide/svelte/icons/plus';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import { companies, contacts } from '#lib/collection.svelte.js';
	import CompanyDialog from '#lib/crm/CompanyDialog.svelte';
	import type { Company } from '#lib/types.js';

	$effect(() => companies.use());
	$effect(() => contacts.use());

	let search = $state('');
	const q = $derived(search.trim().toLowerCase());
	const rows = $derived(
		q
			? companies.list.filter((c) =>
					[c.name, c.email, c.website, c.phone].some((v) => v?.toLowerCase().includes(q))
				)
			: companies.list
	);
	const contactCount = $derived.by(() => {
		const m = new Map<string, number>();
		for (const c of contacts.list) if (c.company) m.set(c.company, (m.get(c.company) ?? 0) + 1);
		return m;
	});

	let open = $state(false);
	let selected = $state<Company | null>(null);
	function edit(c: Company | null) {
		selected = c;
		open = true;
	}
</script>

<svelte:head><title>Unternehmen – CRM</title></svelte:head>

<div class="mx-auto max-w-6xl p-6">
	<PageHeader title="Unternehmen" bind:search>
		{#snippet actions()}
			<Button onclick={() => edit(null)}><PlusIcon /> Neues Unternehmen</Button>
		{/snippet}
	</PageHeader>

	{#if companies.error}<p class="mb-4 text-sm text-destructive">{companies.error}</p>{/if}

	<div class="rounded-lg border bg-card">
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head>Name</Table.Head>
					<Table.Head>Website</Table.Head>
					<Table.Head>E-Mail</Table.Head>
					<Table.Head>Telefon</Table.Head>
					<Table.Head class="text-right">Kontakte</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each rows as c (c.id)}
					<Table.Row class="cursor-pointer" onclick={() => edit(c)}>
						<Table.Cell class="font-medium">{c.name}</Table.Cell>
						<Table.Cell>
							{#if c.website}
								<a
									href={c.website}
									target="_blank"
									rel="noopener noreferrer"
									class="text-primary hover:underline"
									onclick={(e) => e.stopPropagation()}>{c.website.replace(/^https?:\/\//, '')}</a
								>
							{/if}
						</Table.Cell>
						<Table.Cell>{c.email}</Table.Cell>
						<Table.Cell>{c.phone}</Table.Cell>
						<Table.Cell class="text-right tabular-nums">{contactCount.get(c.id) ?? 0}</Table.Cell>
					</Table.Row>
				{:else}
					<Table.Row>
						<Table.Cell colspan={5} class="py-8 text-center text-muted-foreground">
							{companies.loaded ? (q ? 'Keine Treffer.' : 'Noch keine Unternehmen.') : 'Lädt …'}
						</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	</div>
</div>

<CompanyDialog company={selected} bind:open />
