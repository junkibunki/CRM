<script lang="ts">
	import { untrack } from 'svelte';
	import Building2Icon from '@lucide/svelte/icons/building-2';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import HistoryIcon from '@lucide/svelte/icons/history';
	import ListTodoIcon from '@lucide/svelte/icons/list-todo';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import UserRoundIcon from '@lucide/svelte/icons/user-round';
	import UsersIcon from '@lucide/svelte/icons/users';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/dialog/index.js';
	import type { BoardStore } from '#lib/board.svelte.js';
	import { companyName, contacts, userLabel } from '#lib/collection.svelte.js';
	import { typeLabel } from '#lib/activities/types.js';
	import { firstLine, relativeDay } from '#lib/last-activity/format.js';
	import type { LastActivityStore } from '#lib/last-activity/last.svelte.js';
	import { formatDateTime } from '#lib/lead/format.js';
	import GateBadge from '#lib/gates/GateBadge.svelte';
	import type { GateStore } from '#lib/gates/gates.svelte.js';
	import { clock } from '#lib/todos/clock.svelte.js';
	import { dueStatus, formatDue, localDay } from '#lib/todos/due.js';
	import { DUE_TEXT, DUE_TONE } from '#lib/todos/NextTodoBadge.svelte';
	import type { PipelineTodoStore } from '#lib/todos/pipeline.svelte.js';
	import TodoForm from '#lib/todos/TodoForm.svelte';
	import { cn } from '#lib/utils.js';
	import type { Lead } from '#lib/types.js';
	import {
		formatCreated,
		formatDay,
		previewData,
		previewStatus,
		type PreviewData,
		type PreviewLookups
	} from './preview';

	type Props = {
		store: BoardStore;
		/** open to-dos of the pipeline (F7): next to-do, tick it off, add one */
		todos?: PipelineTodoStore;
		/** latest activity per lead of the pipeline (F4) */
		activity?: LastActivityStore;
		/** stage requirements and checks (F12): the same warning as on the card */
		gates?: GateStore;
		/** id of the lead to show; looked up in the store, so realtime changes show at once */
		leadId: string | null;
		open: boolean;
		onedit: (lead: Lead) => void;
	};
	let { store, todos, activity, gates, leadId, open = $bindable(), onedit }: Props = $props();

	const lookups: PreviewLookups = {
		company: companyName,
		contact: (id) => contacts.get(id),
		user: userLabel,
		nextTodo: (id) => (todos?.loaded ? (todos.nextFor(id) ?? null) : undefined),
		lastActivity: (id) => (activity?.loaded ? (activity.of(id) ?? null) : undefined),
		gateOpen: (id, column) =>
			gates?.loaded ? gates.openFor(id, column, store.columns).map((r) => r.label) : []
	};

	let todoOpen = $state(false);

	// "today" (overdue) from the shared clock: flips at midnight also while open
	const data = $derived(
		open && leadId ? previewData(store, leadId, lookups, localDay(clock.now)) : null
	);
	// last shown state: keeps the content during the exit animation. Raw: it is replaced as a
	// whole (a fresh object per change of `data`), never mutated, so no deep proxy is needed
	let shown = $state.raw<PreviewData | null>(null);
	// "Bearbeiten" hands over to the lead dialog: the focus must stay there, not go back to the
	// card when this dialog has closed (bits-ui restores it after the exit animation)
	let handedOver = false;
	const todoStatus = $derived(shown?.nextTodo ? dueStatus(shown.nextTodo, clock.now) : null);
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
		handedOver = true;
		open = false;
		onedit(shown.lead);
	}

	$effect(() => {
		if (open) handedOver = false; // a fresh opening restores the focus normally again
	});

	function onCloseAutoFocus(e: Event) {
		if (!handedOver) return;
		handedOver = false;
		e.preventDefault();
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md" {onCloseAutoFocus}>
		{#if shown}
			{@const v = shown}
			<Dialog.Header class="pr-8">
				<Dialog.Title class="leading-snug break-words">{v.lead.title}</Dialog.Title>
				<Dialog.Description class="flex items-center gap-2">
					<span class={cn('size-2.5 shrink-0 rounded-full', v.dot)}></span>
					{v.column?.name ?? '–'}
				</Dialog.Description>
				{#if v.gateOpen.length}
					<GateBadge labels={v.gateOpen} />
				{/if}
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

				{#if v.lastActivity !== undefined}
					<dt class="flex items-start gap-1.5 text-muted-foreground">
						<HistoryIcon class="mt-0.5 size-4" />Letzte Aktivität
					</dt>
					<dd class="min-w-0">
						{#if v.lastActivity}
							{@const a = v.lastActivity}
							<p>
								{typeLabel(a.type)} ·
								<time datetime={a.occurred_at.replace(' ', 'T')} title={formatDateTime(a.occurred_at)}>
									{relativeDay(a.occurred_at, clock.now)}
								</time>
							</p>
							{#if firstLine(a)}
								<p class="truncate text-muted-foreground" title={firstLine(a)}>{firstLine(a)}</p>
							{/if}
						{:else}
							<span class="text-muted-foreground">Noch keine</span>
						{/if}
					</dd>
				{/if}

				{#if todos && v.nextTodo !== undefined}
					<dt class="flex items-start gap-1.5 text-muted-foreground">
						<ListTodoIcon class="mt-0.5 size-4" />Nächstes To-Do
					</dt>
					<dd class="flex min-w-0 flex-col items-start gap-1">
						{#if v.nextTodo}
							{@const t = v.nextTodo}
							{#key t.id}
								<label class="flex min-w-0 items-start gap-2">
									<input
										type="checkbox"
										class="mt-0.5 size-4 shrink-0 cursor-pointer accent-primary"
										aria-label="„{t.title}“ abhaken"
										title="Abhaken"
										checked={false}
										onchange={async (e) => {
											// the next to-do is always open: the box mirrors that, also when
											// saving fails and the same to-do comes back (same key, same element)
											const box = e.currentTarget;
											await todos.complete(t.id);
											box.checked = false;
										}}
									/>
									<span class="min-w-0 break-words">
										<span
											class={cn(
												'mr-1 rounded px-1 font-medium tabular-nums',
												todoStatus && DUE_TONE[todoStatus],
												todoStatus === 'future' && 'px-0'
											)}
										>
											{#if todoStatus}<span class="sr-only">{DUE_TEXT[todoStatus]}:</span>{/if}
											{formatDue(t, clock.now)}
										</span>
										{t.title}
									</span>
								</label>
							{/key}
						{:else}
							<span class="text-muted-foreground">{v.closed ? '–' : 'Kein nächster Schritt'}</span>
						{/if}
						<Button variant="ghost" size="xs" class="-ml-2 text-muted-foreground" onclick={() => (todoOpen = true)}>
							<PlusIcon /> To-Do
						</Button>
					</dd>
				{/if}
			</dl>

			<Dialog.Footer>
				<Button variant="outline" onclick={edit}>Bearbeiten</Button>
				<Button href="/leads/{v.lead.id}">Öffnen</Button>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>

{#if todos && shown}
	{@const t = todos}
	{@const id = shown.lead.id}
	<TodoForm
		bind:open={todoOpen}
		description="Für „{shown.lead.title}“"
		save={(data) => t.create(id, data)}
	/>
{/if}

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
