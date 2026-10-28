<script lang="ts">
	import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
	import {
		draggable,
		dropTargetForElements
	} from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
	import { autoScrollForElements } from '@atlaskit/pragmatic-drag-and-drop-auto-scroll/element';
	import {
		attachClosestEdge,
		extractClosestEdge,
		type Edge
	} from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
	import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
	import type { BoardStore } from '#lib/board.svelte.js';
	import type { LastActivityStore } from '#lib/last-activity/last.svelte.js';
	import type { PipelineTodoStore } from '#lib/todos/pipeline.svelte.js';
	import { cn } from '#lib/utils.js';
	import {
		COLUMN_COLORS,
		isCardData,
		isColumnData,
		type BoardColumn,
		type Lead,
		type CardField,
		type CardListDropData,
		type ColumnDragData
	} from '#lib/types.js';
	import KanbanCard from './KanbanCard.svelte';

	type Props = {
		store: BoardStore;
		column: BoardColumn;
		fields: CardField[];
		todos?: PipelineTodoStore;
		activity?: LastActivityStore;
		onopencard: (lead: Lead) => void;
		onadd: (column: BoardColumn) => void;
		onedit: (column: BoardColumn) => void;
		ondelete: (column: BoardColumn) => void;
	};
	let { store, column, fields, todos, activity, onopencard, onadd, onedit, ondelete }: Props =
		$props();
	const showActivity = $derived(fields.includes('last_activity'));

	const leads = $derived(store.leads[column.id] ?? []);
	const overLimit = $derived(column.wip_limit > 0 && leads.length > column.wip_limit);

	let section = $state<HTMLElement>();
	let handle = $state<HTMLElement>();
	let list = $state<HTMLElement>();
	let dragging = $state(false);
	let edge = $state<Edge | null>(null);
	let cardOver = $state(false);

	// column reordering: header is the handle, the whole column is the drop target
	$effect(() => {
		if (!section || !handle) return;
		const element = section;
		const columnId = column.id;
		const data: ColumnDragData = { type: 'column', columnId };
		return combine(
			draggable({
				element,
				dragHandle: handle,
				getInitialData: () => data,
				onDragStart: () => (dragging = true),
				onDrop: () => (dragging = false)
			}),
			dropTargetForElements({
				element,
				canDrop: ({ source }) => isColumnData(source.data) && source.data.columnId !== columnId,
				getData: ({ input }) =>
					attachClosestEdge(data, { input, element, allowedEdges: ['left', 'right'] }),
				getIsSticky: () => true,
				onDrag: ({ self }) => (edge = extractClosestEdge(self.data)),
				onDragLeave: () => (edge = null),
				onDrop: () => (edge = null)
			})
		);
	});

	// card list: drop into empty space appends, scrolls while dragging near the edges
	$effect(() => {
		if (!list) return;
		const element = list;
		const data: CardListDropData = { type: 'card-list', columnId: column.id };
		return combine(
			dropTargetForElements({
				element,
				canDrop: ({ source }) => isCardData(source.data),
				getData: () => data,
				onDragEnter: () => (cardOver = true),
				onDragLeave: () => (cardOver = false),
				onDrop: () => (cardOver = false)
			}),
			autoScrollForElements({ element })
		);
	});

</script>

<section
	bind:this={section}
	class={cn(
		'relative flex max-h-full w-72 shrink-0 flex-col rounded-lg bg-muted/70',
		dragging && 'opacity-40'
	)}
>
	{#if edge === 'left'}
		<div class="absolute top-0 -left-[7px] h-full w-0.5 rounded bg-primary"></div>
	{:else if edge === 'right'}
		<div class="absolute top-0 -right-[7px] h-full w-0.5 rounded bg-primary"></div>
	{/if}

	<header bind:this={handle} class="flex cursor-grab items-center gap-2 px-3 pt-2.5 pb-2">
		<span
			class={cn('size-2.5 shrink-0 rounded-full', COLUMN_COLORS[column.color || 'gray'].dot)}
		></span>
		<h2 class="min-w-0 flex-1 truncate text-sm font-semibold">{column.name}</h2>
		<span
			class={cn('text-xs tabular-nums text-muted-foreground', overLimit && 'font-semibold text-destructive')}
			title={column.wip_limit > 0 ? `WIP-Limit ${column.wip_limit}` : undefined}
		>
			{leads.length}{column.wip_limit > 0 ? ` / ${column.wip_limit}` : ''}
		</span>
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Button {...props} variant="ghost" size="icon-xs" aria-label="Spaltenmenü">
						<EllipsisIcon />
					</Button>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="end">
				<DropdownMenu.Item onSelect={() => onedit(column)}>Bearbeiten</DropdownMenu.Item>
				<DropdownMenu.Separator />
				<DropdownMenu.Item variant="destructive" onSelect={() => ondelete(column)}>
					Löschen
				</DropdownMenu.Item>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	</header>

	<div
		bind:this={list}
		class={cn(
			'flex min-h-12 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2 transition-colors',
			cardOver && 'bg-accent/50'
		)}
	>
		{#each leads as lead (lead.id)}
			<KanbanCard
				{lead}
				{fields}
				nextTodo={todos?.loaded ? (todos.nextFor(lead.id) ?? null) : undefined}
				closed={!!column.closed}
				lastActivity={showActivity ? activity?.of(lead.id) : undefined}
				onopen={onopencard}
			/>
		{/each}
	</div>

	<div class="px-2 pb-2">
		<Button
			variant="ghost"
			size="sm"
			class="w-full justify-start text-muted-foreground"
			onclick={() => onadd(column)}
		>
			<PlusIcon /> Lead
		</Button>
	</div>
</section>
