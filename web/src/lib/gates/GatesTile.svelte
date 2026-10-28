<script lang="ts">
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import CircleIcon from '@lucide/svelte/icons/circle';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import XIcon from '@lucide/svelte/icons/x';
	import { userLabel } from '#lib/collection.svelte.js';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { formatDateTime } from '#lib/lead/format.js';
	import type { BoardColumn, Lead } from '#lib/types.js';
	import type { GateStore } from './gates.svelte';
	import { gateFailure, type GatePrompt } from './prompt.svelte';
	import { ACTION_LABELS, tileRows, type TileRow } from './tile';

	/**
	 * Lead page (F2): status of every requirement of the pipeline (who, when, value),
	 * confirm / change / revoke (with a warning) and the log. Live through `gates` (forLead).
	 */
	type Props = { gates: GateStore; lead: Lead; stages: BoardColumn[]; prompt: GatePrompt };
	let { gates, lead, stages, prompt }: Props = $props();

	const rows = $derived(tileRows(gates.requirements, stages, lead.column, gates.checks.get(lead.id)));
	const openNow = $derived(rows.filter((r) => r.applies && !r.done).length);
	const stageName = $derived(stages.find((s) => s.id === lead.column)?.name ?? '');
	let showLog = $state(false);
	let revokeOpen = $state(false);
	let revoking = $state<TileRow | null>(null);

	const by = (id: string) => (id ? userLabel(id) || 'Unbekannt' : 'Administrator');

	function confirm(row: TileRow) {
		const r = row.requirement;
		const change = row.done && r.type === 'text';
		prompt.ask({
			title: change ? `„${r.label}“ ändern` : `„${r.label}“ bestätigen`,
			description: row.applies ? undefined : `Gilt ab „${row.stage}“; schon jetzt bestätigen?`,
			requirements: [r],
			initial: change && row.check ? { [r.id]: row.check.value } : undefined,
			confirmLabel: change ? 'Speichern' : 'Bestätigen',
			run: async (entries) => {
				try {
					await gates.confirm(lead.id, entries);
					return null;
				} catch (err) {
					return gateFailure(err);
				}
			}
		});
	}

	function askRevoke(row: TileRow) {
		revoking = row;
		revokeOpen = true;
	}

	async function revoke() {
		const check = revoking?.check;
		if (!check) return;
		try {
			await gates.revoke(check);
		} catch (err) {
			gates.error = gateFailure(err);
		}
	}

	const revokeText = $derived(
		revoking
			? revoking.applies
				? `„${lead.title}“ steht in „${stageName}“, wo „${revoking.requirement.label}“ verlangt wird. ` +
					'Der Lead bleibt, wo er ist; seine Karte zeigt danach ein Warnsymbol.'
				: `„${revoking.requirement.label}“ ist danach für diesen Lead wieder offen.`
			: ''
	);
</script>

<Card.Root size="sm">
	<Card.Header>
		<Card.Title class="flex items-center gap-2">
			<ShieldCheckIcon class="size-4 text-muted-foreground" /> Bedingungen
			{#if gates.loaded && openNow}
				<span class="text-sm font-normal text-amber-700 dark:text-amber-400">{openNow} offen</span>
			{/if}
		</Card.Title>
	</Card.Header>
	<Card.Content class="flex flex-col gap-2">
		{#if gates.error}
			<div class="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-destructive" role="alert">
				<span class="flex-1">{gates.error}</span>
				<Button variant="ghost" size="icon-xs" aria-label="Meldung schließen" onclick={() => gates.clearError()}>
					<XIcon />
				</Button>
			</div>
		{/if}

		{#if !gates.loaded}
			<p class="text-muted-foreground">Lädt …</p>
		{:else if !rows.length}
			<p class="text-muted-foreground">Diese Pipeline hat keine Bedingungen.</p>
		{:else}
			<ul class="-my-1 divide-y" aria-label="Bedingungen">
				{#each rows as row (row.requirement.id)}
					{@const r = row.requirement}
					<li class="flex items-start gap-2 py-2">
						{#if row.done}
							<CircleCheckIcon class="mt-0.5 size-4 shrink-0 text-emerald-600" aria-label="erfüllt" />
						{:else if row.applies}
							<TriangleAlertIcon class="mt-0.5 size-4 shrink-0 text-amber-600" aria-label="offen" />
						{:else}
							<CircleIcon class="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="später" />
						{/if}
						<div class="min-w-0 flex-1">
							<p class="font-medium break-words">{r.label}</p>
							<p class="text-xs text-muted-foreground">ab „{row.stage}“</p>
							{#if row.done && row.check}
								{#if r.type === 'text'}<p class="break-words">{row.check.value}</p>{/if}
								<p class="text-xs text-muted-foreground">
									{by(row.check.by)} · {formatDateTime(row.check.updated || row.check.created)}
								</p>
							{:else if r.hint}
								<p class="text-xs break-words text-muted-foreground">{r.hint}</p>
							{/if}
						</div>
						<div class="flex shrink-0 flex-col items-end gap-1">
							{#if !row.done}
								<Button size="xs" variant="outline" onclick={() => confirm(row)}>Bestätigen</Button>
							{:else}
								{#if r.type === 'text'}
									<Button size="xs" variant="ghost" onclick={() => confirm(row)}>Ändern</Button>
								{/if}
								<Button size="xs" variant="ghost" onclick={() => askRevoke(row)}>Zurücknehmen</Button>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		{/if}

		{#if gates.loaded && gates.events.length}
			<button
				type="button"
				class="mt-1 flex items-center gap-1 self-start text-xs font-medium text-muted-foreground hover:text-foreground"
				aria-expanded={showLog}
				onclick={() => (showLog = !showLog)}
			>
				<ChevronRightIcon class="size-3.5 transition-transform {showLog ? 'rotate-90' : ''}" />
				Protokoll ({gates.events.length})
			</button>
			{#if showLog}
				<ol class="flex flex-col gap-1.5 text-xs" aria-label="Protokoll">
					{#each gates.events as ev (ev.id)}
						<li>
							<span class="font-medium">{by(ev.by)}</span> hat „{ev.requirement_label}“
							{ACTION_LABELS[ev.action] ?? ev.action}{#if ev.value && ev.value !== 'true'}: {ev.value}{/if}
							<span class="block text-muted-foreground">{formatDateTime(ev.created)}</span>
						</li>
					{/each}
				</ol>
			{/if}
		{/if}
	</Card.Content>
</Card.Root>

<ConfirmDialog
	bind:open={revokeOpen}
	title="Bestätigung zurücknehmen?"
	description={revokeText}
	confirmLabel="Zurücknehmen"
	onconfirm={revoke}
/>
