<script lang="ts">
	import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
	import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
	import ArrowUpDownIcon from '@lucide/svelte/icons/arrow-up-down';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { goto } from '$app/navigation';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import { companies, contacts } from '#lib/collection.svelte.js';
	import { companyLeads } from '#lib/company/leads.svelte.js';
	import {
		DEFAULT_COMPANY_SORT,
		filterCompanies,
		sortCompanies,
		toggleCompanySort,
		type CompanySortKey
	} from '#lib/company/table.js';
	import CompanyDialog from '#lib/crm/CompanyDialog.svelte';
	import { websiteHref, websiteLabel } from '#lib/lead/format.js';
	import type { Company } from '#lib/types.js';

	$effect(() => companies.use());
	$effect(() => contacts.use());
	$effect(() => companyLeads.use());

	let search = $state('');
	let sort = $state(DEFAULT_COMPANY_SORT);
	const q = $derived(search.trim());

	const contactCount = $derived.by(() => {
		const m = new Map<string, number>();
		for (const c of contacts.list) if (c.company) m.set(c.company, (m.get(c.company) ?? 0) + 1);
		return m;
	});
	const rows = $derived(
		sortCompanies(filterCompanies(companies.list, q), sort, {
			contacts: contactCount,
			leads: companyLeads.activeCounts
		})
	);

	const columns: { key: CompanySortKey; label: string; numeric?: boolean }[] = [
		{ key: 'name', label: 'Name' },
		{ key: 'website', label: 'Website' },
		{ key: 'email', label: 'E-Mail' },
		{ key: 'phone', label: 'Telefon' },
		{ key: 'contacts', label: 'Kontakte', numeric: true },
		{ key: 'leads', label: 'Aktive Leads', numeric: true }
	];

	let open = $state(false);
	function create() {
		open = true;
	}
</script>

<svelte:head><title>Unternehmen – CRM</title></svelte:head>

<div class="mx-auto max-w-6xl p-6">
	<PageHeader title="Unternehmen" bind:search>
		{#snippet actions()}
			<Button onclick={create}><PlusIcon /> Neues Unternehmen</Button>
		{/snippet}
	</PageHeader>

	{#if companies.error}<p class="mb-4 text-sm text-destructive">{companies.error}</p>{/if}
	{#if companyLeads.error}<p class="mb-4 text-sm text-destructive">{companyLeads.error}</p>{/if}

	<div class="rounded-lg border bg-card">
		<Table.Root>
			<Table.Header>
				<Table.Row>
					{#each columns as col (col.key)}
						{@const active = sort.key === col.key}
						<Table.Head
							class={col.numeric ? 'text-right' : ''}
							aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
						>
							<button
								type="button"
								class="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-muted {col.numeric
									? '-mr-2'
									: '-ml-2'}"
								onclick={() => (sort = toggleCompanySort(sort, col.key))}
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
				{#each rows as c (c.id)}
					<Table.Row class="cursor-pointer" onclick={() => goto(`/unternehmen/${c.id}`)}>
						<Table.Cell class="font-medium">
							<!-- a real link: keyboard, middle click, "open in new tab" -->
							<a href="/unternehmen/{c.id}" class="hover:underline" onclick={(e) => e.stopPropagation()}
								>{c.name}</a
							>
						</Table.Cell>
						<Table.Cell>
							{#if c.website}
								<a
									href={websiteHref(c.website)}
									target="_blank"
									rel="noopener noreferrer"
									class="text-link hover:underline"
									onclick={(e) => e.stopPropagation()}>{websiteLabel(c.website)}</a
								>
							{/if}
						</Table.Cell>
						<Table.Cell>{c.email}</Table.Cell>
						<Table.Cell>{c.phone}</Table.Cell>
						<Table.Cell class="text-right tabular-nums">{contactCount.get(c.id) ?? 0}</Table.Cell>
						<Table.Cell class="text-right tabular-nums">
							{companyLeads.loaded ? (companyLeads.activeCounts.get(c.id) ?? 0) : '…'}
						</Table.Cell>
					</Table.Row>
				{:else}
					<Table.Row>
						<Table.Cell colspan={columns.length} class="py-8 text-center text-muted-foreground">
							{companies.loaded ? (q ? 'Keine Treffer.' : 'Noch keine Unternehmen.') : 'Lädt …'}
						</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	</div>
</div>

<CompanyDialog company={null} bind:open onsaved={(c: Company) => goto(`/unternehmen/${c.id}`)} />
