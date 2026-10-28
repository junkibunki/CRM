<script lang="ts">
	import { untrack } from 'svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { changedFields } from '#lib/diff.js';
	import { cn } from '#lib/utils.js';
	import { COLUMN_COLORS, type BoardColumn, type ColumnColor } from '#lib/types.js';

	type ColumnData = Pick<BoardColumn, 'name' | 'color' | 'wip_limit' | 'closed'>;
	type Props = {
		/** null = create a new column */
		column: BoardColumn | null;
		open: boolean;
		/** full data for a new column, only the changed fields for an edit */
		onsave: (data: Partial<ColumnData>) => void;
	};
	let { column, open = $bindable(), onsave }: Props = $props();

	let name = $state('');
	let color = $state<ColumnColor>('gray');
	let wip = $state<number | null>(null);
	let closed = $state(false);
	// values when the dialog opened; an edit saves only what changed (concurrent edits)
	let initial: ColumnData | null = null;

	$effect(() => {
		if (!open) return;
		untrack(() => {
			name = column?.name ?? '';
			color = column?.color || 'gray';
			wip = column?.wip_limit || null;
			closed = !!column?.closed;
			initial = column ? { name, color, wip_limit: wip ?? 0, closed } : null;
		});
	});

	const colors = Object.entries(COLUMN_COLORS) as [ColumnColor, { label: string; dot: string }][];

	function save(e: SubmitEvent) {
		e.preventDefault();
		if (!name.trim()) return;
		open = false;
		const data: ColumnData = { name: name.trim(), color, wip_limit: wip ?? 0, closed };
		if (!initial) return onsave(data);
		const changed = changedFields(initial, data);
		if (Object.keys(changed).length) onsave(changed);
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-sm">
		<form class="flex flex-col gap-4" onsubmit={save}>
			<Dialog.Header>
				<Dialog.Title>{column ? 'Spalte bearbeiten' : 'Neue Spalte'}</Dialog.Title>
			</Dialog.Header>

			<div class="grid gap-1.5">
				<Label for="col-name">Name</Label>
				<Input id="col-name" bind:value={name} required maxlength={100} />
			</div>

			<fieldset class="grid gap-1.5">
				<legend class="mb-1.5 text-sm font-medium">Farbe</legend>
				<div class="flex gap-2">
					{#each colors as [value, c] (value)}
						<button
							type="button"
							title={c.label}
							aria-label={c.label}
							aria-pressed={color === value}
							onclick={() => (color = value)}
							class={cn(
								'size-7 rounded-full ring-offset-2 ring-offset-background',
								c.dot,
								color === value && 'ring-2 ring-ring'
							)}
						></button>
					{/each}
				</div>
			</fieldset>

			<div class="grid gap-1.5">
				<Label for="col-wip">WIP-Limit (leer = keins)</Label>
				<Input id="col-wip" type="number" min="0" step="1" bind:value={wip} />
			</div>

			<label class="flex items-start gap-2 text-sm">
				<input type="checkbox" class="mt-0.5 size-4 accent-primary" bind:checked={closed} />
				<span>
					<span class="font-medium">Abgeschlossene Phase</span>
					<span class="block text-xs text-muted-foreground">
						z. B. Gewonnen oder Verloren: Hier wird kein nächster Schritt erwartet.
					</span>
				</span>
			</label>

			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (open = false)}>Abbrechen</Button>
				<Button type="submit">Speichern</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
