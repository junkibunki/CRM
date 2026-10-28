<script lang="ts">
	import Building2Icon from '@lucide/svelte/icons/building-2';
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import MailIcon from '@lucide/svelte/icons/mail';
	import MapPinIcon from '@lucide/svelte/icons/map-pin';
	import PhoneIcon from '@lucide/svelte/icons/phone';
	import UsersIcon from '@lucide/svelte/icons/users';
	import * as Card from '#lib/components/ui/card/index.js';
	import { companies, contacts } from '#lib/collection.svelte.js';
	import type { Company } from '#lib/types.js';
	import { companyContactCount, telHref, websiteHref, websiteLabel } from './format';

	type Props = { companyId: string; onopen: (company: Company) => void };
	let { companyId, onopen }: Props = $props();

	const company = $derived(companies.get(companyId));
	const count = $derived(companyContactCount(companyId, contacts.list));
</script>

<Card.Root size="sm">
	<Card.Header>
		<Card.Title class="flex items-center gap-2">
			<Building2Icon class="size-4 text-muted-foreground" /> Unternehmen
		</Card.Title>
	</Card.Header>
	<Card.Content>
		{#if company}
			<button
				type="button"
				class="-mx-2 block w-[calc(100%+1rem)] rounded-md px-2 py-1.5 text-left font-medium hover:bg-muted/50"
				onclick={() => onopen(company)}
				title="Unternehmen bearbeiten"
			>
				{company.name}
			</button>
			<ul class="-mt-2 flex flex-col gap-1.5 text-sm">
				{#if company.website}
					<li class="flex items-center gap-2">
						<GlobeIcon class="size-4 shrink-0 text-muted-foreground" />
						<a
							href={websiteHref(company.website)}
							target="_blank"
							rel="noopener noreferrer"
							class="truncate text-primary hover:underline">{websiteLabel(company.website)}</a
						>
					</li>
				{/if}
				{#if company.email}
					<li class="flex items-center gap-2">
						<MailIcon class="size-4 shrink-0 text-muted-foreground" />
						<a href="mailto:{company.email}" class="truncate text-primary hover:underline">{company.email}</a>
					</li>
				{/if}
				{#if company.phone}
					<li class="flex items-center gap-2">
						<PhoneIcon class="size-4 shrink-0 text-muted-foreground" />
						{#if telHref(company.phone)}
							<a href={telHref(company.phone)} class="text-primary hover:underline">{company.phone}</a>
						{:else}
							{company.phone}
						{/if}
					</li>
				{/if}
				{#if company.address}
					<li class="flex items-start gap-2">
						<MapPinIcon class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
						<span class="whitespace-pre-line">{company.address}</span>
					</li>
				{/if}
				<li class="flex items-center gap-2 text-muted-foreground">
					<UsersIcon class="size-4 shrink-0" />
					{count === 1 ? '1 Kontakt' : `${count} Kontakte`}
				</li>
			</ul>
		{:else}
			<p class="text-muted-foreground">
				{companies.loaded ? 'Unternehmen nicht gefunden.' : 'Lädt …'}
			</p>
		{/if}
	</Card.Content>
</Card.Root>
