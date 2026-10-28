<script lang="ts">
	import Building2Icon from '@lucide/svelte/icons/building-2';
	import UserRoundIcon from '@lucide/svelte/icons/user-round';
	import { companyName, userLabel } from '#lib/collection.svelte.js';
	import { cn } from '#lib/utils.js';
	import { clock } from './clock.svelte';
	import { dueStatus, formatDue } from './due';
	import type { LeadInfo } from './mine.svelte';
	import { DUE_TEXT, DUE_TONE } from './NextTodoBadge.svelte';
	import type { OpenTodo } from './types';

	type Props = {
		todo: OpenTodo;
		lead: LeadInfo | undefined;
		/** show who is responsible (the "all users" view) */
		showOwner: boolean;
		oncomplete: (todo: OpenTodo) => void;
	};
	let { todo, lead, showOwner, oncomplete }: Props = $props();

	const status = $derived(dueStatus(todo, clock.now));
	const due = $derived(formatDue(todo, clock.now));
	const company = $derived(lead ? companyName(lead.company) : '');
</script>

<li class="flex items-start gap-3 px-4 py-2.5">
	<input
		type="checkbox"
		class="mt-0.5 size-4 shrink-0 cursor-pointer accent-primary"
		checked={false}
		aria-label={`„${todo.title}“ abhaken`}
		title="Abhaken"
		onchange={() => oncomplete(todo)}
	/>
	<div class="min-w-0 flex-1">
		<p class="break-words">{todo.title}</p>
		<div class="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
			<span class={cn('rounded font-medium tabular-nums', DUE_TONE[status], status !== 'future' && 'px-1')}>
				<span class="sr-only">{DUE_TEXT[status]}:</span>
				{due}
			</span>
			{#if lead}
				<a
					href="/leads/{lead.id}"
					class="min-w-0 truncate font-medium text-primary hover:underline"
					title="Lead öffnen"
				>
					{lead.title}
				</a>
				{#if company}
					<span class="inline-flex min-w-0 items-center gap-1 truncate">
						<Building2Icon class="size-3 shrink-0" />{company}
					</span>
				{/if}
				{#if showOwner}
					<span class="inline-flex min-w-0 items-center gap-1 truncate">
						<UserRoundIcon class="size-3 shrink-0" /><span class="sr-only">Zuständig:</span>
						{userLabel(lead.owner)}
					</span>
				{/if}
			{:else}
				<a href="/leads/{todo.lead}" class="text-primary hover:underline">Lead öffnen</a>
			{/if}
		</div>
	</div>
</li>
