<script module lang="ts">
	// shared by all cards: building Intl formatters per card is measurably slow
	// dates are stored as UTC midnight; format them in UTC so the day never shifts
	const day = new Intl.DateTimeFormat('de-DE', {
		day: '2-digit',
		month: '2-digit',
		year: '2-digit',
		timeZone: 'UTC'
	});
</script>

<script lang="ts">
	import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
	import {
		draggable,
		dropTargetForElements
	} from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
	import {
		attachClosestEdge,
		extractClosestEdge,
		type Edge
	} from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
	import Building2Icon from '@lucide/svelte/icons/building-2';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import UsersIcon from '@lucide/svelte/icons/users';
	import { companyName, contactLabel, userLabel } from '#lib/collection.svelte.js';
	import HistoryIcon from '@lucide/svelte/icons/history';
	import { typeLabel } from '#lib/activities/types.js';
	import { relativeDay, type LastActivity } from '#lib/last-activity/format.js';
	import { clock } from '#lib/todos/clock.svelte.js';
	import { localDay } from '#lib/todos/due.js';
	import NextTodoBadge from '#lib/todos/NextTodoBadge.svelte';
	import GateBadge from '#lib/gates/GateBadge.svelte';
	import type { OpenTodo } from '#lib/todos/types.js';
	import { cn } from '#lib/utils.js';
	import {
		isCardData,
		toDateInput,
		type CardDragData,
		type CardField,
		type Lead
	} from '#lib/types.js';

	type Props = {
		lead: Lead;
		fields: CardField[];
		/** next open to-do; null = none, undefined = not known (yet), then nothing is shown */
		nextTodo?: OpenTodo | null;
		/** the lead's stage is closed: no "Kein nächster Schritt" hint */
		closed?: boolean;
		/** latest activity (F4), only passed when the card field is on */
		lastActivity?: LastActivity;
		/** F12: labels of requirements of the lead's stage it has not fulfilled (warning) */
		gateOpen?: string[];
		onopen: (lead: Lead) => void;
	};
	let { lead, fields, nextTodo, closed = false, lastActivity, gateOpen = [], onopen }: Props =
		$props();
	const activityAgo = $derived(lastActivity ? relativeDay(lastActivity.occurred_at, clock.now) : '');

	let el = $state<HTMLElement>();
	let dragging = $state(false);
	let edge = $state<Edge | null>(null);

	const close = $derived(toDateInput(lead.expected_close));
	// today in local time from the shared clock, so "overdue" flips at midnight without a reload
	// (only cards with a date read it)
	const overdue = $derived(close !== '' && close < localDay(clock.now));
	const owner = $derived(lead.owner ? userLabel(lead.owner) : '');
	const company = $derived(fields.includes('company') ? companyName(lead.company) : '');
	const people = $derived(
		fields.includes('contacts') ? lead.contacts.map(contactLabel).filter(Boolean).join(', ') : ''
	);
	const show = $derived({
		close: fields.includes('expected_close') && close !== '',
		owner: fields.includes('owner') && owner !== '',
		todo: fields.includes('next_todo') && nextTodo !== undefined
	});

	$effect(() => {
		if (!el) return;
		const element = el;
		const cardId = lead.id;
		// lead.column is read lazily inside the callbacks, so a move doesn't re-register
		const data = (): CardDragData => ({ type: 'card', cardId, columnId: lead.column });
		return combine(
			draggable({
				element,
				getInitialData: data,
				onDragStart: () => (dragging = true),
				onDrop: () => (dragging = false)
			}),
			dropTargetForElements({
				element,
				// the dragged card is a target too: dropping it back onto itself must be a no-op,
				// not fall through to the list below (which would append it)
				canDrop: ({ source }) => isCardData(source.data),
				getData: ({ input }) =>
					attachClosestEdge(data(), { input, element, allowedEdges: ['top', 'bottom'] }),
				getIsSticky: () => true,
				onDrag: ({ self, source }) =>
					(edge =
						isCardData(source.data) && source.data.cardId === cardId
							? null
							: extractClosestEdge(self.data)),
				onDragLeave: () => (edge = null),
				onDrop: () => (edge = null)
			})
		);
	});

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onopen(lead);
		}
	}
</script>

<div class="relative">
	{#if edge === 'top'}
		<div class="absolute -top-[5px] right-0 left-0 h-0.5 rounded bg-primary"></div>
	{/if}
	<div
		bind:this={el}
		role="button"
		tabindex="0"
		onclick={() => onopen(lead)}
		{onkeydown}
		class={cn(
			// content-visibility: off-screen cards skip layout and paint, so long columns stay cheap.
			// On this element, not the wrapper: its paint containment would clip the drop lines.
			'[contain-intrinsic-size:auto_4.5rem] [content-visibility:auto]',
			'cursor-grab rounded-md border bg-card p-2.5 text-sm shadow-xs transition-colors hover:border-ring/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:cursor-grabbing',
			dragging && 'opacity-40'
		)}
	>
		<p class="leading-snug font-medium break-words">{lead.title}</p>
		{#if gateOpen.length}
			<GateBadge labels={gateOpen} />
		{/if}
		{#if company}
			<p class="mt-1 flex items-center gap-1 truncate text-xs text-muted-foreground">
				<Building2Icon class="size-3 shrink-0" />{company}
			</p>
		{/if}
		{#if people}
			<p class="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
				<UsersIcon class="size-3 shrink-0" />{people}
			</p>
		{/if}
		{#if show.todo}
			<NextTodoBadge todo={nextTodo ?? undefined} {closed} />
		{/if}
		{#if lastActivity}
			<p
				class="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground"
				title="Letzte Aktivität: {typeLabel(lastActivity.type)} {activityAgo}"
			>
				<HistoryIcon class="size-3 shrink-0" /><span class="sr-only">Letzte Aktivität:</span>{activityAgo}
			</p>
		{/if}
		{#if show.close || show.owner}
			<div class="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
				{#if show.close}
					<span
						class={cn('inline-flex items-center gap-1', overdue && 'text-destructive')}
						title="Voraussichtlicher Abschluss"
					>
						<CalendarIcon class="size-3" />{day.format(new Date(close))}
					</span>
				{/if}
				{#if show.owner}
					<span
						class="ml-auto flex size-5 items-center justify-center rounded-full bg-accent text-[10px] font-semibold text-accent-foreground"
						title="Zuständig: {owner}"
					>
						{owner.slice(0, 1).toUpperCase()}
					</span>
				{/if}
			</div>
		{/if}
	</div>
	{#if edge === 'bottom'}
		<div class="absolute right-0 -bottom-[5px] left-0 h-0.5 rounded bg-primary"></div>
	{/if}
</div>
