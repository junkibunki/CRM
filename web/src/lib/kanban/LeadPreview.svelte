<script lang="ts">
	import { untrack } from 'svelte';
	import Building2Icon from '@lucide/svelte/icons/building-2';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import UserRoundIcon from '@lucide/svelte/icons/user-round';
	import UsersIcon from '@lucide/svelte/icons/users';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import type { BoardStore } from '#lib/board.svelte.js';
	import { companyName, contacts, userLabel } from '#lib/collection.svelte.js';
	import { cn } from '#lib/utils.js';
	import type { Lead } from '#lib/types.js';
	import {
		formatCreated,
		formatDay,
		localDate,
		previewData,
		previewStatus,
		type PreviewData,
		type PreviewLookups
	} from './preview';

	type Props = {
		store: BoardStore;
		/** id of the lead to show; looked up in the store, so realtime changes show at once */
		leadId: string | null;
		open: boolean;
		onedit: (lead: Lead) => void;
	};
	let { store, leadId, open = $bindable(), onedit }: Props = $props();

	const lookups: PreviewLookups = {
		company: companyName,
		contact: (id) => contacts.get(id),
		user: userLabel
	};

	// reads `open`, so "today" (overdue) is fresh on every opening
	const data = $derived(
		open && leadId ? previewData(store, leadId, lookups, localDate()) : null
	);
	// last shown state: keeps the content during the exit animation
	let shown = $state<PreviewData | null>(null);
	let notice = $state('');
	let noticeTimer: ReturnType<typeof setTimeout> | undefined;

	$effect(() => {
		const status = previewStatus(open, leadId, data);
		if (status === 'show') shown = data;
		else if (status === 'gone') {
			// deleted (or its stage deleted) by someone else while open
			open = false;
			const title = untrack(() => shown?.lead.title);
			notice = title
				? `Der Lead „${title}“ wurde inzwischen gelöscht.`
				: 'Der Lead wurde inzwischen gelöscht.';
			clearTimeout(noticeTimer);
			noticeTimer = setTimeout(() => (notice = ''), 5000);
		}
	});
	$effect(() => () => clearTimeout(noticeTimer));

	function edit() {
		if (!shown) return;
		open = false;
		onedit(shown.lead);
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		{#if shown}
			{@const v = shown}
			<Dialog.Header class="pr-8">
				<Dialog.Title class="leading-snug break-words">{v.lead.title}</Dialog.Title>
				<Dialog.Description class="flex items-center gap-2">
					<span class={cn('size-2.5 shrink-0 rounded-full', v.dot)}></span>
					{v.column?.name ?? '–'}
				</Dialog.Description>
			</Dialog.Header>

			<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2.5">
				<dt class="flex items-center gap-1.5 text-muted-foreground">
					<Building2Icon class="size-4" />Unternehmen
				</dt>
				<dd class="min-w-0 break-words">{v.company || '–'}</dd>

				<dt class="flex items-start gap-1.5 text-muted-foreground">
					<UsersIcon class="mt-0.5 size-4" />Kontakte
				</dt>
				<dd class="min-w-0">
					{#each v.contacts as c (c.id)}
						<p class="break-words">
							{c.name}{#if c.position}<span class="text-muted-foreground">, {c.position}</span>{/if}
						</p>
					{:else}
						–
					{/each}
				</dd>

				<dt class="flex items-center gap-1.5 text-muted-foreground" title="Voraussichtlicher Abschluss">
					<CalendarIcon class="size-4" />Abschluss
				</dt>
				<dd class={cn(v.overdue && 'font-medium text-destructive')}>
					{#if v.close}
						{formatDay(v.close)}{#if v.overdue}&nbsp;(überfällig){/if}
					{:else}
						–
					{/if}
				</dd>

				<dt class="flex items-center gap-1.5 text-muted-foreground">
					<UserRoundIcon class="size-4" />Zuständig
				</dt>
				<dd class="min-w-0 break-words">{v.owner || '–'}</dd>

				<dt class="flex items-center gap-1.5 text-muted-foreground">
					<ClockIcon class="size-4" />Erstellt am
				</dt>
				<dd>{formatCreated(v.lead.created) || '–'}</dd>
			</dl>

			<Dialog.Footer>
				<Button variant="outline" onclick={edit}>Bearbeiten</Button>
				<Button href="/leads/{v.lead.id}">Öffnen</Button>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<!-- always in the DOM, so screen readers announce the notice when it appears -->
<div
	role="status"
	class="pointer-events-none fixed bottom-4 left-1/2 z-50 max-w-[calc(100%-2rem)] -translate-x-1/2"
>
	{#if notice}
		<p
			class="rounded-md border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md"
		>
			{notice}
		</p>
	{/if}
</div>
