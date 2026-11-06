<script lang="ts">
	import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
	import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
	import ArrowUpDownIcon from '@lucide/svelte/icons/arrow-up-down';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import { companies, companyName, contacts } from '#lib/collection.svelte.js';
	import ContactDialog from '#lib/crm/ContactDialog.svelte';
	import {
		DEFAULT_SORT,
		NO_COMPANY,
		filterContacts,
		groupByCompany,
		sortContacts,
		toggleSort,
		type SortKey
	} from '#lib/crm/contact-table.js';
	import { contactName, type Contact } from '#lib/types.js';

	$effect(() => contacts.use());
	$effect(() => companies.use());

	let search = $state('');
	let companyFilter = $state('');
	let sort = $state(DEFAULT_SORT);

	// Wird das gefilterte Unternehmen gelöscht, gilt wieder „alle".
	const company = $derived(
		companyFilter && companyFilter !== NO_COMPANY && !companies.get(companyFilter) ? '' : companyFilter
	);
	// Ohne geladene Unternehmen stünden alle Kontakte kurz unter „Ohne Unternehmen".
	const ready = $derived(contacts.loaded && companies.loaded);
	const filtering = $derived(search.trim() !== '' || company !== '');
	const rows = $derived(
		sortContacts(
			filterContacts(contacts.list, { query: search, company }, companyName),
			sort,
			companyName
		)
	);
	// Nach Unternehmen sortiert: ein Block pro Unternehmen; sonst eine flache Liste.
	const groups = $derived(
		sort.key === 'company'
			? groupByCompany(rows, companyName)
			: [{ key: '', label: '', rows }]
	);
	const companyOptions = $derived(
		[...companies.list].sort((a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }))
	);
	const filterLabel = $derived(
		company === '' ? 'Alle Unternehmen' : company === NO_COMPANY ? 'Ohne Unternehmen' : companyName(company)
	);

	const columns: { key: SortKey; label: string }[] = [
		{ key: 'name', label: 'Name' },
		{ key: 'company', label: 'Unternehmen' },
		{ key: 'position', label: 'Position' },
		{ key: 'email', label: 'E-Mail' },
		{ key: 'phone', label: 'Telefon' }
	];

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
			<Select.Root type="single" bind:value={companyFilter}>
				<Select.Trigger class="w-52" aria-label="Nach Unternehmen filtern">
					<span class="truncate">{filterLabel}</span>
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="" label="Alle Unternehmen" />
					<Select.Item value={NO_COMPANY} label="Ohne Unternehmen" />
					<Select.Separator />
					{#each companyOptions as c (c.id)}
						<Select.Item value={c.id} label={c.name} />
					{/each}
				</Select.Content>
			</Select.Root>
			<Button onclick={() => edit(null)}><PlusIcon /> Neuer Kontakt</Button>
		{/snippet}
	</PageHeader>

	{#if contacts.error || companies.error}
		<p class="mb-4 text-sm text-destructive">{contacts.error || companies.error}</p>
	{/if}

	<div class="rounded-lg border bg-card">
		<Table.Root>
			<Table.Header>
				<Table.Row>
					{#each columns as col (col.key)}
						{@const active = sort.key === col.key}
						<Table.Head
							aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
						>
							<button
								type="button"
								class="-ml-2 inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-muted"
								onclick={() => (sort = toggleSort(sort, col.key))}
							>
								{col.label}
								{#if !active}
									<ArrowUpDownIcon class="size-3.5 text-muted-foreground/60" />
								{:else if sort.dir === 'asc'}
									<ArrowUpIcon class="size-3.5" />
								{:else}
									<ArrowDownIcon class="size-3.5" />
								{/if}
							</button>
						</Table.Head>
					{/each}
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each ready ? groups : [] as group (group.key)}
					{#if group.label}
						<Table.Row class="bg-muted/50 hover:bg-muted/50">
							<Table.Cell colspan={5} class="py-1.5 text-xs font-semibold text-muted-foreground">
								{group.label}
								<span class="font-normal">· {group.rows.length}</span>
							</Table.Cell>
						</Table.Row>
					{/if}
					{#each group.rows as c (c.id)}
						<Table.Row class="cursor-pointer" onclick={() => edit(c)}>
							<Table.Cell class="font-medium">{contactName(c)}</Table.Cell>
							<Table.Cell>
								{#if c.company && companies.get(c.company)}
									<a
										href="/unternehmen/{c.company}"
										class="text-link hover:underline"
										onclick={(e) => e.stopPropagation()}>{companyName(c.company)}</a
									>
								{/if}
							</Table.Cell>
							<Table.Cell>{c.position}</Table.Cell>
							<Table.Cell>
								{#if c.email}
									<a
										href="mailto:{c.email}"
										class="text-link hover:underline"
										onclick={(e) => e.stopPropagation()}>{c.email}</a
									>
								{/if}
							</Table.Cell>
							<Table.Cell>{c.phone}</Table.Cell>
						</Table.Row>
					{/each}
				{/each}
				{#if !ready || rows.length === 0}
					<Table.Row>
						<Table.Cell colspan={5} class="py-8 text-center text-muted-foreground">
							{ready ? (filtering ? 'Keine Treffer.' : 'Noch keine Kontakte.') : 'Lädt …'}
						</Table.Cell>
					</Table.Row>
				{/if}
			</Table.Body>
		</Table.Root>
	</div>
</div>

<ContactDialog contact={selected} bind:open />
