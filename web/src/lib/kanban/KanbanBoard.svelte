<script lang="ts">
	import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
	import { monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
	import { autoScrollForElements } from '@atlaskit/pragmatic-drag-and-drop-auto-scroll/element';
	import { extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import type { BoardStore } from '#lib/board.svelte.js';
	import {
		DEFAULT_CARD_FIELDS,
		isCardData,
		isCardListData,
		isColumnData,
		type BoardColumn,
		type Lead
	} from '#lib/types.js';
	import ColumnDialog from './ColumnDialog.svelte';
	import KanbanColumn from './KanbanColumn.svelte';
	import LeadDialog from './LeadDialog.svelte';

	let { store }: { store: BoardStore } = $props();

	// card_fields is a free JSON field: anything but an array would break every card
	const fields = $derived(
		Array.isArray(store.board?.card_fields) ? store.board.card_fields : DEFAULT_CARD_FIELDS
	);

	let scroller = $state<HTMLElement>();

	$effect(() => {
		if (!scroller) return;
		const element = scroller;
		return combine(
			monitorForElements({
				canMonitor: ({ source }) => isCardData(source.data) || isColumnData(source.data),
				onDrop: ({ source, location }) => {
					const target = location.current.dropTargets[0];
					if (target) drop(source.data, target.data);
				}
			}),
			autoScrollForElements({ element })
		);
	});

	type Data = Record<string | symbol, unknown>;

	function drop(src: Data, dst: Data) {
		if (isCardData(src)) {
			let columnId: string;
			let toIndex: number;
			if (isCardData(dst)) {
				if (dst.cardId === src.cardId) return; // dropped onto itself
				columnId = dst.columnId;
				const others = (store.leads[columnId] ?? []).filter((c) => c.id !== src.cardId);
				const i = others.findIndex((c) => c.id === dst.cardId);
				if (i === -1) return;
				toIndex = extractClosestEdge(dst) === 'bottom' ? i + 1 : i;
			} else if (isCardListData(dst)) {
				columnId = dst.columnId;
				toIndex = (store.leads[columnId] ?? []).filter((c) => c.id !== src.cardId).length;
			} else return;
			// unchanged position: nothing to save
			const current = (store.leads[columnId] ?? []).findIndex((c) => c.id === src.cardId);
			if (current === toIndex) return;
			store.moveLead(src.cardId, columnId, toIndex);
		} else if (isColumnData(src) && isColumnData(dst)) {
			const others = store.columns.filter((c) => c.id !== src.columnId);
			const i = others.findIndex((c) => c.id === dst.columnId);
			if (i === -1) return;
			const toIndex = extractClosestEdge(dst) === 'right' ? i + 1 : i;
			if (store.columns.findIndex((c) => c.id === src.columnId) === toIndex) return;
			store.moveColumn(src.columnId, toIndex);
		}
	}

	// dialogs; the selected record stays set after closing so the exit animation keeps its content
	let leadOpen = $state(false);
	let lead = $state<Lead | null>(null);
	let leadColumn = $state<BoardColumn | null>(null);
	let columnOpen = $state(false);
	let column = $state<BoardColumn | null>(null);
	let deleteOpen = $state(false);
	let toDelete = $state<BoardColumn | null>(null);

	function openLead(l: Lead) {
		lead = l;
		leadColumn = null;
		leadOpen = true;
	}
	function newLead(c: BoardColumn) {
		lead = null;
		leadColumn = c;
		leadOpen = true;
	}
	function editColumn(c: BoardColumn | null) {
		column = c;
		columnOpen = true;
	}
	function askDeleteColumn(c: BoardColumn) {
		toDelete = c;
		deleteOpen = true;
	}
	function saveColumn(data: Partial<Pick<BoardColumn, 'name' | 'color' | 'wip_limit'>>) {
		if (column) store.updateColumn(column.id, data);
		else store.addColumn({ name: '', color: 'gray', wip_limit: 0, ...data });
	}
	function deleteColumn() {
		deleteOpen = false;
		if (toDelete) store.deleteColumn(toDelete.id);
	}
</script>

<div bind:this={scroller} class="flex h-full items-start gap-3 overflow-x-auto p-4">
	{#each store.columns as col (col.id)}
		<KanbanColumn
			{store}
			column={col}
			{fields}
			onopencard={openLead}
			onadd={newLead}
			onedit={editColumn}
			ondelete={askDeleteColumn}
		/>
	{/each}
	<Button variant="outline" class="w-72 shrink-0 border-dashed" onclick={() => editColumn(null)}>
		<PlusIcon /> Spalte hinzufügen
	</Button>
</div>

<LeadDialog {store} {lead} column={leadColumn} bind:open={leadOpen} />
<ColumnDialog {column} bind:open={columnOpen} onsave={saveColumn} />

<Dialog.Root bind:open={deleteOpen}>
	<Dialog.Content class="sm:max-w-sm">
		<Dialog.Header>
			<Dialog.Title>Spalte löschen?</Dialog.Title>
			<Dialog.Description>
				„{toDelete?.name}“ wird mit {(toDelete && store.leads[toDelete.id]?.length) || 0} Lead(s)
				endgültig gelöscht.
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (deleteOpen = false)}>Abbrechen</Button>
			<Button variant="destructive" onclick={deleteColumn}>Löschen</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
