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
	import { cardDrop, columnDrop, type CardTarget } from './drop';
	import KanbanColumn from './KanbanColumn.svelte';
	import LeadDialog from './LeadDialog.svelte';
	import LeadPreview from './LeadPreview.svelte';

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

	// the index maths lives in drop.ts (pure, unit-tested); this only maps the DnD data
	function drop(src: Data, dst: Data) {
		if (isCardData(src)) {
			const target: CardTarget | null = isCardData(dst)
				? { kind: 'card', cardId: dst.cardId, columnId: dst.columnId, edge: extractClosestEdge(dst) }
				: isCardListData(dst)
					? { kind: 'list', columnId: dst.columnId }
					: null;
			const move = target && cardDrop(store.leads, src.cardId, target);
			if (move) store.moveLead(src.cardId, move.columnId, move.toIndex);
		} else if (isColumnData(src) && isColumnData(dst)) {
			const toIndex = columnDrop(store.columns, src.columnId, dst.columnId, extractClosestEdge(dst));
			if (toIndex !== null) store.moveColumn(src.columnId, toIndex);
		}
	}

	// dialogs; the selected record stays set after closing so the exit animation keeps its content
	let previewOpen = $state(false);
	let previewId = $state<string | null>(null);
	let leadOpen = $state(false);
	let lead = $state<Lead | null>(null);
	let leadColumn = $state<BoardColumn | null>(null);
	let columnOpen = $state(false);
	let column = $state<BoardColumn | null>(null);
	let deleteOpen = $state(false);
	let toDelete = $state<BoardColumn | null>(null);

	// a click on a card opens the quick view; "Bearbeiten" there opens the lead dialog
	function previewLead(l: Lead) {
		previewId = l.id;
		previewOpen = true;
	}
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
			onopencard={previewLead}
			onadd={newLead}
			onedit={editColumn}
			ondelete={askDeleteColumn}
		/>
	{/each}
	<Button variant="outline" class="w-72 shrink-0 border-dashed" onclick={() => editColumn(null)}>
		<PlusIcon /> Spalte hinzufügen
	</Button>
</div>

<LeadPreview {store} leadId={previewId} bind:open={previewOpen} onedit={openLead} />
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
