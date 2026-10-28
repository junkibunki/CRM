<script lang="ts">
	import { untrack } from 'svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/dialog/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { changedFields } from '#lib/diff.js';
	import { draftError, newDraft, toDrafts } from '#lib/gates/editor.js';
	import RequirementsEditor from '#lib/gates/RequirementsEditor.svelte';
	import type { RequirementChange, RequirementDraft, StageRequirement } from '#lib/gates/types.js';
	import { cn } from '#lib/utils.js';
	import { COLUMN_COLORS, type BoardColumn, type ColumnColor } from '#lib/types.js';

	type ColumnData = Pick<BoardColumn, 'name' | 'color' | 'wip_limit' | 'closed' | 'gates_exempt'>;
	type Props = {
		/** null = create a new column */
		column: BoardColumn | null;
		open: boolean;
		/**
		 * requirements of the stage (F12); undefined = the section is not shown (gates not
		 * loaded). The draft passed to `onsave` is null when the requirements were left alone.
		 */
		requirements?: StageRequirement[];
		/**
		 * full data for a new column, only the changed fields for an edit; `requirements`: the
		 * draft and the stage's requirements when the dialog opened (null = left alone)
		 */
		onsave: (data: Partial<ColumnData>, requirements: RequirementChange | null) => void;
	};
	let { column, open = $bindable(), requirements, onsave }: Props = $props();

	let name = $state('');
	let color = $state<ColumnColor>('gray');
	let wip = $state<number | null>(null);
	let closed = $state(false);
	// F12: no requirements apply in this stage (e.g. "Verloren"); then it has none of its own
	let exempt = $state(false);
	// F12: "Soll diese Phase Bedingungen haben?" (new stage), then the editor's draft
	let gated = $state(false);
	let drafts = $state<RequirementDraft[]>([]);
	let removedExisting = $state(0);
	let error = $state('');
	// the draft when the dialog opened: unchanged = nothing to save for the requirements
	let initialDrafts = '';
	let initialRequirements: StageRequirement[] = [];
	// values when the dialog opened; an edit saves only what changed (concurrent edits)
	let initial: ColumnData | null = null;

	$effect(() => {
		if (!open) return;
		untrack(() => {
			name = column?.name ?? '';
			color = column?.color || 'gray';
			wip = column?.wip_limit || null;
			closed = !!column?.closed;
			exempt = !!column?.gates_exempt;
			initial = column ? { name, color, wip_limit: wip ?? 0, closed, gates_exempt: exempt } : null;
			initialRequirements = $state.snapshot(requirements ?? []) as StageRequirement[];
			drafts = toDrafts(initialRequirements);
			gated = drafts.length > 0;
			initialDrafts = JSON.stringify(drafts);
			removedExisting = 0;
			error = '';
		});
	});

	function setGated(v: boolean) {
		gated = v;
		if (v && drafts.length === 0) drafts.push(newDraft());
	}

	const colors = Object.entries(COLUMN_COLORS) as [ColumnColor, { label: string; dot: string }][];

	function save(e: SubmitEvent) {
		e.preventDefault();
		if (!name.trim()) return;
		// "Nein" on a new stage: no requirements, whatever was typed before; an exempt stage
		// leaves its requirements alone (they count only for later stages, the server takes no
		// new ones)
		const list = requirements === undefined || exempt ? null : gated || column ? drafts : [];
		const draft = list && JSON.stringify(list) !== initialDrafts ? $state.snapshot(list) : null;
		error = draft ? draftError(draft) : '';
		if (error) return;
		open = false;
		const reqs = draft && { draft, initial: initialRequirements };
		const data: ColumnData = { name: name.trim(), color, wip_limit: wip ?? 0, closed, gates_exempt: exempt };
		if (!initial) return onsave(data, reqs);
		const changed = changedFields(initial, data);
		if (Object.keys(changed).length || reqs) onsave(changed, reqs);
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[90vh] overflow-y-auto sm:max-w-md">
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

			{#if requirements !== undefined}
				<fieldset class="grid gap-2">
					<legend class="mb-1 text-sm font-medium">Bedingungen ab dieser Phase</legend>
					<p class="-mt-1 text-xs text-muted-foreground">
						Müssen erfüllt sein, bevor ein Lead in diese oder eine spätere Phase kommt.
					</p>
					<label class="flex items-start gap-2 text-sm">
						<input type="checkbox" class="mt-0.5 size-4 accent-primary" bind:checked={exempt} />
						<span>
							<span class="font-medium">Bedingungen gelten in dieser Phase nicht</span>
							<span class="block text-xs text-muted-foreground">
								z. B. Verloren: Leads kommen ohne Bestätigungen hierher, auch keine der früheren Phasen.
							</span>
						</span>
					</label>
					{#if exempt}
						{#if column && requirements.length}
							<p class="text-xs text-muted-foreground">
								Die {requirements.length} Bedingung(en) dieser Phase gelten hier nicht, aber weiter für spätere Phasen.
							</p>
						{/if}
					{:else if !column}
						<div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm" role="radiogroup" aria-label="Soll diese Phase Bedingungen haben?">
							<span>Soll diese Phase Bedingungen haben?</span>
							<label class="flex items-center gap-1.5">
								<input type="radio" name="col-gated" class="accent-primary" checked={gated} onchange={() => setGated(true)} /> Ja
							</label>
							<label class="flex items-center gap-1.5">
								<input type="radio" name="col-gated" class="accent-primary" checked={!gated} onchange={() => setGated(false)} /> Nein
							</label>
						</div>
					{/if}
					{#if !exempt && (column || gated)}
						<RequirementsEditor bind:items={drafts} bind:removedExisting />
					{/if}
				</fieldset>
			{/if}

			{#if error}<p class="text-sm text-destructive" role="alert">{error}</p>{/if}

			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (open = false)}>Abbrechen</Button>
				<Button type="submit">Speichern</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
