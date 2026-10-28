<script lang="ts">
	import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
	import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import { newDraft } from './editor';
	import { REQUIREMENT_TYPES, type RequirementDraft, type RequirementType } from './types';

	/**
	 * Requirements of one stage in the stage dialog: label, kind (yes/no or text), hint;
	 * add, edit, delete, reorder. Works on a draft; the dialog saves it (editor.ts).
	 */
	let {
		items = $bindable(),
		removedExisting = $bindable(0)
	}: { items: RequirementDraft[]; removedExisting?: number } = $props();

	const typeLabel = (t: RequirementType) => REQUIREMENT_TYPES.find((x) => x.value === t)?.label ?? t;

	function add() {
		items.push(newDraft());
	}
	function remove(i: number) {
		const [d] = items.splice(i, 1);
		if (d?.id) removedExisting++;
	}
	function shift(i: number, by: -1 | 1) {
		const j = i + by;
		if (j < 0 || j >= items.length) return;
		const [d] = items.splice(i, 1);
		items.splice(j, 0, d);
	}
</script>

<div class="flex flex-col gap-2">
	{#each items as d, i (d.key)}
		<div class="flex flex-col gap-2 rounded-md border p-2.5" role="group" aria-label="Bedingung {i + 1}">
			<div class="flex items-center gap-2">
				<Input
					bind:value={d.label}
					placeholder="Bezeichnung, z. B. Bei Siemens als Lead geflaggt"
					aria-label="Bezeichnung"
					maxlength={200}
					class="flex-1"
				/>
				{#if d.id}
					<!-- the kind of an existing requirement stays: its confirmations depend on it -->
					<span class="w-24 shrink-0 text-center text-xs text-muted-foreground" title="Art (nach dem Anlegen fest)">
						{typeLabel(d.type)}
					</span>
				{:else}
					<Select.Root type="single" bind:value={() => d.type, (v) => v && (d.type = v as RequirementType)}>
						<Select.Trigger class="w-24 shrink-0" aria-label="Art">{typeLabel(d.type)}</Select.Trigger>
						<Select.Content>
							{#each REQUIREMENT_TYPES as t (t.value)}
								<Select.Item value={t.value} label={t.label} />
							{/each}
						</Select.Content>
					</Select.Root>
				{/if}
			</div>
			<Input
				bind:value={d.hint}
				placeholder="Hinweis (optional), z. B. wen man informieren muss"
				aria-label="Hinweis"
				maxlength={1000}
			/>
			<div class="flex items-center justify-end gap-1">
				<Button type="button" variant="ghost" size="icon-xs" aria-label="Nach oben" disabled={i === 0} onclick={() => shift(i, -1)}>
					<ArrowUpIcon />
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					aria-label="Nach unten"
					disabled={i === items.length - 1}
					onclick={() => shift(i, 1)}
				>
					<ArrowDownIcon />
				</Button>
				<Button type="button" variant="ghost" size="icon-xs" aria-label="Bedingung löschen" onclick={() => remove(i)}>
					<Trash2Icon />
				</Button>
			</div>
		</div>
	{:else}
		<p class="text-xs text-muted-foreground">Keine Bedingungen.</p>
	{/each}
	<Button type="button" variant="outline" size="sm" class="self-start" onclick={add}>
		<PlusIcon /> Bedingung
	</Button>
	{#if removedExisting > 0}
		<p class="text-xs text-muted-foreground">
			Gelöschte Bedingungen nehmen ihre Bestätigungen mit; das Protokoll bleibt.
		</p>
	{/if}
</div>
