<script lang="ts">
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import Building2Icon from '@lucide/svelte/icons/building-2';
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import KanbanIcon from '@lucide/svelte/icons/kanban';
	import MailIcon from '@lucide/svelte/icons/mail';
	import MapPinIcon from '@lucide/svelte/icons/map-pin';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import PhoneIcon from '@lucide/svelte/icons/phone';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import UsersIcon from '@lucide/svelte/icons/users';
	import { goto } from '$app/navigation';
	import { companies, contacts, userLabel, users } from '#lib/collection.svelte.js';
	import { companyLeads } from '#lib/company/leads.svelte.js';
	import type { CompanyLead } from '#lib/company/leads.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import CompanyDialog from '#lib/crm/CompanyDialog.svelte';
	import ContactDialog from '#lib/crm/ContactDialog.svelte';
	import { formatDay, telHref, websiteHref, websiteLabel } from '#lib/lead/format.js';
	import { cn } from '#lib/utils.js';
	import { COLUMN_COLORS, contactName, type Contact } from '#lib/types.js';
	import type { PageProps } from './$types';

	let { params }: PageProps = $props();

	$effect(() => companies.use());
	$effect(() => contacts.use());
	$effect(() => users.use());
	$effect(() => companyLeads.use());

	const company = $derived(companies.get(params.id));
	const people = $derived(contacts.list.filter((c) => c.company === params.id));
	const leads = $derived(companyLeads.ofCompany(params.id));

	// deleted here (dialog) or by someone else while open: back to the list. A plain
	// variable, not $state: it only remembers that this id was there (see CLAUDE.md)
	let seenId = '';
	$effect(() => {
		if (company) seenId = company.id;
		else if (seenId === params.id) goto('/unternehmen');
	});

	function dot(color: string) {
		return COLUMN_COLORS[color as keyof typeof COLUMN_COLORS]?.dot ?? COLUMN_COLORS.gray.dot;
	}

	let companyOpen = $state(false);
	let contactOpen = $state(false);
	let contact = $state<Contact | null>(null);
	function openContact(c: Contact | null) {
		contact = c;
		contactOpen = true;
	}
</script>

<svelte:head><title>{company?.name ?? 'Unternehmen'} – CRM</title></svelte:head>

{#snippet leadRow(l: CompanyLead, closed: boolean)}
	{@const stage = companyLeads.stageOf(l.column)}
	<Table.Row class={cn('cursor-pointer', closed && 'text-muted-foreground')} onclick={() => goto(`/leads/${l.id}`)}>
		<Table.Cell class="font-medium">
			<a href="/leads/{l.id}" class="hover:underline" onclick={(e) => e.stopPropagation()}>{l.title}</a>
		</Table.Cell>
		<Table.Cell>
			<span class="inline-flex items-center gap-1.5">
				<span class={cn('size-2 shrink-0 rounded-full', dot(stage?.color ?? ''))}></span>
				{stage?.name ?? '–'}
			</span>
		</Table.Cell>
		<Table.Cell>{userLabel(l.owner)}</Table.Cell>
		<Table.Cell class="tabular-nums">{formatDay(l.expected_close)}</Table.Cell>
		<Table.Cell class="tabular-nums">{formatDay(l.created)}</Table.Cell>
	</Table.Row>
{/snippet}

<div class="h-full overflow-y-auto">
	<div class="mx-auto flex max-w-7xl flex-col gap-4 p-4 sm:p-6">
		<div>
			<Button href="/unternehmen" variant="ghost" size="sm" class="-ml-2">
				<ArrowLeftIcon /> Unternehmen
			</Button>
		</div>

		{#each [companies.error, contacts.error, users.error].filter(Boolean) as err (err)}
			<p class="text-sm text-destructive">{err}</p>
		{/each}

		{#if company}
			<div class="flex flex-wrap items-start gap-3">
				<div class="mr-auto min-w-0">
					<h1 class="flex items-center gap-2 text-xl font-semibold">
						<Building2Icon class="size-5 shrink-0 text-muted-foreground" />
						<span class="truncate">{company.name}</span>
					</h1>
					<div class="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
						{#if company.website}
							<a
								href={websiteHref(company.website)}
								target="_blank"
								rel="noopener noreferrer"
								class="flex items-center gap-1.5 text-link hover:underline"
								><GlobeIcon class="size-4" />{websiteLabel(company.website)}</a
							>
						{/if}
						{#if company.email}
							<a href="mailto:{company.email}" class="flex items-center gap-1.5 text-link hover:underline"
								><MailIcon class="size-4" />{company.email}</a
							>
						{/if}
						{#if company.phone}
							{#if telHref(company.phone)}
								<a href={telHref(company.phone)} class="flex items-center gap-1.5 text-link hover:underline"
									><PhoneIcon class="size-4" />{company.phone}</a
								>
							{:else}
								<span class="flex items-center gap-1.5"><PhoneIcon class="size-4" />{company.phone}</span>
							{/if}
						{/if}
					</div>
				</div>
				<Button variant="outline" onclick={() => (companyOpen = true)}><PencilIcon /> Bearbeiten</Button>
			</div>

			<div class="grid grid-cols-3 gap-3 sm:max-w-xl">
				{#each [{ label: 'Aktive Leads', value: companyLeads.loaded ? leads.active.length : '…' }, { label: 'Abgeschlossen', value: companyLeads.loaded ? leads.closed.length : '…' }, { label: 'Kontakte', value: people.length }] as stat (stat.label)}
					<div class="rounded-lg border bg-card px-3 py-2">
						<div class="text-2xl font-semibold tabular-nums">{stat.value}</div>
						<div class="text-xs text-muted-foreground">{stat.label}</div>
					</div>
				{/each}
			</div>

			<div class="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
				<div class="flex flex-col gap-4">
					<Card.Root size="sm">
						<Card.Header>
							<Card.Title class="flex items-center gap-2">
								<KanbanIcon class="size-4 text-muted-foreground" /> Leads
							</Card.Title>
						</Card.Header>
						<Card.Content class="px-0">
							{#if companyLeads.error}
								<p class="px-4 text-destructive">{companyLeads.error}</p>
							{:else if !companyLeads.loaded}
								<p class="px-4 text-muted-foreground">Lädt …</p>
							{:else if leads.active.length + leads.closed.length === 0}
								<p class="px-4 text-muted-foreground">Noch keine Leads.</p>
							{:else}
								<Table.Root>
									<Table.Header>
										<Table.Row>
											<Table.Head class="pl-4">Lead</Table.Head>
											<Table.Head>Phase</Table.Head>
											<Table.Head>Zuständig</Table.Head>
											<Table.Head>Abschluss</Table.Head>
											<Table.Head>Angelegt</Table.Head>
										</Table.Row>
									</Table.Header>
									<Table.Body class="[&_td:first-child]:pl-4">
										{#each leads.active as l (l.id)}
											{@render leadRow(l, false)}
										{:else}
											<Table.Row class="hover:bg-transparent">
												<Table.Cell colspan={5} class="text-muted-foreground">Keine aktiven Leads.</Table.Cell>
											</Table.Row>
										{/each}
										{#if leads.closed.length}
											<Table.Row class="bg-muted/50 hover:bg-muted/50">
												<Table.Cell colspan={5} class="py-1.5 text-xs font-semibold text-muted-foreground">
													Abgeschlossen <span class="font-normal">· {leads.closed.length}</span>
												</Table.Cell>
											</Table.Row>
											{#each leads.closed as l (l.id)}
												{@render leadRow(l, true)}
											{/each}
										{/if}
									</Table.Body>
								</Table.Root>
							{/if}
						</Card.Content>
					</Card.Root>

					<Card.Root size="sm">
						<Card.Header>
							<Card.Title class="flex items-center gap-2">
								<UsersIcon class="size-4 text-muted-foreground" /> Kontakte
							</Card.Title>
							<Card.Action>
								<Button variant="outline" size="sm" onclick={() => openContact(null)}>
									<PlusIcon /> Neuer Kontakt
								</Button>
							</Card.Action>
						</Card.Header>
						<Card.Content class="px-0">
							{#if people.length === 0}
								<p class="px-4 text-muted-foreground">
									{contacts.loaded ? 'Diesem Unternehmen ist noch kein Kontakt zugeordnet.' : 'Lädt …'}
								</p>
							{:else}
								<Table.Root>
									<Table.Header>
										<Table.Row>
											<Table.Head class="pl-4">Name</Table.Head>
											<Table.Head>Position</Table.Head>
											<Table.Head>E-Mail</Table.Head>
											<Table.Head>Telefon</Table.Head>
										</Table.Row>
									</Table.Header>
									<Table.Body>
										{#each people as c (c.id)}
											<Table.Row class="cursor-pointer" onclick={() => openContact(c)}>
												<Table.Cell class="pl-4 font-medium">{contactName(c)}</Table.Cell>
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
												<Table.Cell>
													{#if c.phone && telHref(c.phone)}
														<a
															href={telHref(c.phone)}
															class="text-link hover:underline"
															onclick={(e) => e.stopPropagation()}>{c.phone}</a
														>
													{:else}
														{c.phone}
													{/if}
												</Table.Cell>
											</Table.Row>
										{/each}
									</Table.Body>
								</Table.Root>
							{/if}
						</Card.Content>
					</Card.Root>
				</div>

				<aside class="order-first flex flex-col gap-4 lg:order-none">
					<Card.Root size="sm">
						<Card.Header>
							<Card.Title class="flex items-center gap-2">
								<Building2Icon class="size-4 text-muted-foreground" /> Stammdaten
							</Card.Title>
						</Card.Header>
						<Card.Content class="flex flex-col gap-3">
							<div>
								<div class="text-xs text-muted-foreground">Adresse</div>
								{#if company.address}
									<p class="flex items-start gap-2 whitespace-pre-line">
										<MapPinIcon class="mt-0.5 size-4 shrink-0 text-muted-foreground" />{company.address}
									</p>
								{:else}
									<p class="text-muted-foreground">–</p>
								{/if}
							</div>
							<div>
								<div class="text-xs text-muted-foreground">Notizen</div>
								<p class="break-words whitespace-pre-line">{company.notes || '–'}</p>
							</div>
							<div>
								<div class="text-xs text-muted-foreground">Angelegt</div>
								<p class="tabular-nums">{formatDay(company.created) || '–'}</p>
							</div>
						</Card.Content>
					</Card.Root>
				</aside>
			</div>
		{:else if companies.loaded}
			<div class="flex flex-col items-start gap-3 rounded-lg border bg-card p-6 text-sm">
				<p>Dieses Unternehmen gibt es nicht (mehr).</p>
				<Button href="/unternehmen" variant="outline" size="sm">Zur Übersicht</Button>
			</div>
		{:else}
			<p class="text-sm text-muted-foreground">Lädt …</p>
		{/if}
	</div>
</div>

{#if company}
	<CompanyDialog {company} bind:open={companyOpen} />
	<ContactDialog {contact} company={company.id} bind:open={contactOpen} />
{/if}
