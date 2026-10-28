<script lang="ts">
	import MailIcon from '@lucide/svelte/icons/mail';
	import PhoneIcon from '@lucide/svelte/icons/phone';
	import UsersIcon from '@lucide/svelte/icons/users';
	import * as Card from '#lib/components/ui/card/index.js';
	import { contacts } from '#lib/collection.svelte.js';
	import { contactName, type Contact, type Lead } from '#lib/types.js';
	import { leadContacts, telHref } from './format';

	type Props = { lead: Lead; onopen: (contact: Contact) => void };
	let { lead, onopen }: Props = $props();

	const list = $derived(leadContacts(lead.contacts, (id) => contacts.get(id)));
</script>

<Card.Root size="sm">
	<Card.Header>
		<Card.Title class="flex items-center gap-2">
			<UsersIcon class="size-4 text-muted-foreground" /> Kontakte
		</Card.Title>
	</Card.Header>
	<Card.Content>
		<ul class="-mx-2 flex flex-col">
			{#each list as c (c.id)}
				<li class="rounded-md px-2 py-1.5 hover:bg-muted/50">
					<button
						type="button"
						class="block w-full text-left"
						onclick={() => onopen(c)}
						title="Kontakt bearbeiten"
					>
						<span class="font-medium">{contactName(c)}</span>
						{#if c.position}<span class="block text-xs text-muted-foreground">{c.position}</span>{/if}
					</button>
					{#if c.email || c.phone}
						<div class="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
							{#if c.email}
								<a href="mailto:{c.email}" class="flex min-w-0 items-center gap-1 text-primary hover:underline">
									<MailIcon class="size-3 shrink-0" /><span class="truncate">{c.email}</span>
								</a>
							{/if}
							{#if c.phone && telHref(c.phone)}
								<a href={telHref(c.phone)} class="flex items-center gap-1 text-primary hover:underline">
									<PhoneIcon class="size-3 shrink-0" />{c.phone}
								</a>
							{:else if c.phone}
								<span>{c.phone}</span>
							{/if}
						</div>
					{/if}
				</li>
			{:else}
				<li class="px-2 py-1.5 text-muted-foreground">
					{contacts.loaded ? 'Keine Kontakte.' : 'Lädt …'}
				</li>
			{/each}
		</ul>
	</Card.Content>
</Card.Root>
