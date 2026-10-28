<script lang="ts">
	import { untrack } from 'svelte';
	import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
	import { monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
	import { autoScrollForElements } from '@atlaskit/pragmatic-drag-and-drop-auto-scroll/element';
	import { extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/dialog/index.js';
	import type { BoardStore } from '#lib/board.svelte.js';
	import GateDialog from '#lib/gates/GateDialog.svelte';
	import type { GateStore } from '#lib/gates/gates.svelte.js';
	import { GatePrompt, moveOnBoard } from '#lib/gates/prompt.svelte.js';
	import type { RequirementChange } from '#lib/gates/types.js';
	import type { LastActivityStore } from '#lib/last-activity/last.svelte.js';
	import type { PipelineTodoStore } from '#lib/todos/pipeline.svelte.js';
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

	type Props = {
		store: BoardStore;
		/** open to-dos of the pipeline (F7): next to-do per lead for cards and quick view */
		todos?: PipelineTodoStore;
		/** latest activity per lead (F4): quick view and the optional card field */
		activity?: LastActivityStore;
		/** stage requirements and checks of the pipeline (F12): gate dialog, lock, card warning */
		gates?: GateStore;
		/** lead whose quick view opens (`/leads?lead=<id>`, e.g. from "Meine To-Dos") */
		previewLead?: string | null;
		/** the quick view opened through `previewLead` was closed (the page drops the parameter) */
		onpreviewclose?: () => void;
	};
	let { store, todos, activity, gates, previewLead = null, onpreviewclose }: Props = $props();

	// the gate dialog ("Bevor ‚<Lead>' nach ‚<Phase>' kann") of a move
	const prompt = new GatePrompt();

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
			if (move) moveCard(src.cardId, move.columnId, move.toIndex);
		} else if (isColumnData(src) && isColumnData(dst)) {
			const toIndex = columnDrop(store.columns, src.columnId, dst.columnId, extractClosestEdge(dst));
			if (toIndex !== null) store.moveColumn(src.columnId, toIndex);
		}
	}

	// into another stage: through its gate (F12). Open requirements -> the dialog asks first and
	// the card stays where it is until "Bestätigen und verschieben" (no optimistic move before)
	function moveCard(id: string, columnId: string, toIndex: number) {
		moveOnBoard(store, gates, prompt, id, columnId, toIndex);
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
	function showPreview(l: Lead) {
		previewId = l.id;
		previewOpen = true;
	}

	// quick view requested by the URL: opens when the parameter appears; closing it tells the
	// page (plain variable: it only remembers that this opening came from the URL)
	let fromUrl = false;
	$effect(() => {
		const id = previewLead;
		if (!id) return;
		untrack(() => {
			previewId = id;
			previewOpen = true;
			fromUrl = true;
		});
	});
	$effect(() => {
		if (previewOpen || !fromUrl) return;
		fromUrl = false;
		untrack(() => onpreviewclose?.());
	});
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
	async function saveColumn(
		data: Partial<Pick<BoardColumn, 'name' | 'color' | 'wip_limit' | 'closed' | 'gates_exempt'>>,
		requirements: RequirementChange | null
	) {
		if (column) {
			const id = column.id;
			if (Object.keys(data).length) store.updateColumn(id, data);
			if (requirements && gates) gates.saveRequirements(id, requirements.draft, requirements.initial);
			return;
		}
		const rec = await store.addColumn({ name: '', color: 'gray', wip_limit: 0, closed: false, gates_exempt: false, ...data });
		if (rec && requirements?.draft.length && gates) gates.saveRequirements(rec.id, requirements.draft, []);
	}
	// requirements of the stage being edited; undefined until the gates are loaded (no section)
	const columnRequirements = $derived(
		gates?.loaded ? (column ? (gates.byColumn.get(column.id) ?? []) : []) : undefined
	);
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
			{todos}
			{activity}
			{gates}
			onopencard={showPreview}
			onadd={newLead}
			onedit={editColumn}
			ondelete={askDeleteColumn}
		/>
	{/each}
	<Button variant="outline" class="w-72 shrink-0 border-dashed" onclick={() => editColumn(null)}>
		<PlusIcon /> Spalte hinzufügen
	</Button>
</div>

<LeadPreview {store} {todos} {activity} {gates} leadId={previewId} bind:open={previewOpen} onedit={openLead} />
<LeadDialog {store} {gates} columns={store.columns} {lead} column={leadColumn} bind:open={leadOpen} />
<ColumnDialog {column} requirements={columnRequirements} bind:open={columnOpen} onsave={saveColumn} />
<GateDialog {prompt} />

<Dialog.Root bind:open={deleteOpen}>
	<Dialog.Content class="sm:max-w-sm">
		<Dialog.Header>
			<Dialog.Title>Spalte löschen?</Dialog.Title>
			<Dialog.Description>
				„{toDelete?.name}“ wird mit {(toDelete && store.leads[toDelete.id]?.length) || 0} Lead(s)
				{#if toDelete && gates?.byColumn.get(toDelete.id)?.length}
					und {gates.byColumn.get(toDelete.id)?.length} Bedingung(en)
				{/if}
				endgültig gelöscht.
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (deleteOpen = false)}>Abbrechen</Button>
			<Button variant="destructive" onclick={deleteColumn}>Löschen</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
