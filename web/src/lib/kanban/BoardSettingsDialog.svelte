<script lang="ts">
	import { untrack } from 'svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import type { BoardStore } from '#lib/board.svelte.js';
	import { changedFields } from '#lib/diff.js';
	import { CARD_FIELDS, DEFAULT_CARD_FIELDS, type CardField } from '#lib/types.js';

	type Props = { store: BoardStore; open: boolean };
	let { store, open = $bindable() }: Props = $props();

	let name = $state('');
	let fields = $state<CardField[]>([]);
	// values when the dialog opened; only what changed is saved (concurrent edits)
	let initial = { name: '', card_fields: [] as CardField[] };

	$effect(() => {
		if (!open) return;
		untrack(() => {
			name = store.board?.name ?? '';
			const current = store.board?.card_fields;
			fields = [...(Array.isArray(current) ? current : DEFAULT_CARD_FIELDS)];
			initial = { name, card_fields: ordered(fields) };
		});
	});

	// canonical order of CARD_FIELDS, so a comparison doesn't depend on click order
	function ordered(list: CardField[]) {
		return CARD_FIELDS.map((f) => f.key).filter((k) => list.includes(k));
	}

	function toggle(key: CardField, on: boolean) {
		fields = on ? [...fields, key] : fields.filter((f) => f !== key);
	}

	function save(e: SubmitEvent) {
		e.preventDefault();
		if (!name.trim()) return;
		open = false;
		const changed = changedFields(initial, { name: name.trim(), card_fields: ordered(fields) });
		if (Object.keys(changed).length) store.updateBoard(changed);
	}

</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-sm">
		<form class="flex flex-col gap-4" onsubmit={save}>
			<Dialog.Header>
				<Dialog.Title>Pipeline-Einstellungen</Dialog.Title>
			</Dialog.Header>

			<div class="grid gap-1.5">
				<Label for="board-name">Name</Label>
				<Input id="board-name" bind:value={name} required maxlength={100} />
			</div>

			<fieldset class="grid gap-2">
				<legend class="mb-1 text-sm font-medium">Auf Karten anzeigen</legend>
				{#each CARD_FIELDS as f (f.key)}
					<label class="flex items-center gap-2 text-sm">
						<input
							type="checkbox"
							class="size-4 accent-primary"
							checked={fields.includes(f.key)}
							onchange={(e) => toggle(f.key, e.currentTarget.checked)}
						/>
						{f.label}
					</label>
				{/each}
			</fieldset>

			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (open = false)}>Abbrechen</Button>
				<Button type="submit">Speichern</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
