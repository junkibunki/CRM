<script lang="ts">
	import { untrack } from 'svelte';
	import InfoIcon from '@lucide/svelte/icons/info';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { entryErrors } from './evaluate';
	import type { GatePrompt } from './prompt.svelte';
	import type { CheckEntry } from './types';

	/**
	 * "Bevor ‚<Lead>' nach ‚<Phase>' kann": the open requirements of a move (or of a new lead,
	 * or a single one on the lead page) as checkbox / text field with the hint below.
	 */
	let { prompt }: { prompt: GatePrompt } = $props();

	const req = $derived(prompt.request);
	// the request's list as it was when the dialog opened (it must not change under the user)
	const items = $derived(req?.requirements ?? []);
	let flags = $state<Record<string, boolean>>({});
	let texts = $state<Record<string, string>>({});
	let busy = $state(false);
	let error = $state('');

	$effect(() => {
		if (!prompt.open) return;
		const r = prompt.request;
		untrack(() => {
			flags = {};
			texts = {};
			for (const item of r?.requirements ?? []) {
				const v = r?.initial?.[item.id] ?? '';
				if (item.type === 'flag') flags[item.id] = v === 'true';
				else texts[item.id] = v;
			}
			error = '';
			busy = false;
		});
	});

	const entries = $derived<CheckEntry[]>(
		items.map((r) => ({
			requirement: r.id,
			value: r.type === 'flag' ? (flags[r.id] ? 'true' : '') : (texts[r.id] ?? '')
		}))
	);
	const missing = $derived(entryErrors(items, entries));

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (busy) return;
		if (missing.length) {
			error = missing.join(' · ');
			return;
		}
		busy = true;
		error = (await prompt.confirm(entries)) ?? '';
		busy = false;
	}
</script>

<Dialog.Root bind:open={prompt.open}>
	<Dialog.Content class="sm:max-w-md">
		<form class="flex flex-col gap-4" onsubmit={submit}>
			<Dialog.Header>
				<Dialog.Title>{req?.title ?? ''}</Dialog.Title>
				{#if req?.description}<Dialog.Description>{req.description}</Dialog.Description>{/if}
			</Dialog.Header>

			<ul class="flex flex-col gap-3">
				{#each items as r (r.id)}
					<li class="rounded-md border p-3">
						{#if r.type === 'flag'}
							<label class="flex items-start gap-2 text-sm font-medium">
								<input
									type="checkbox"
									class="mt-0.5 size-4 shrink-0 accent-primary"
									bind:checked={flags[r.id]}
								/>
								<span>{r.label}</span>
							</label>
						{:else}
							<div class="grid gap-1.5">
								<Label for="gate-{r.id}">{r.label}</Label>
								<Input id="gate-{r.id}" bind:value={texts[r.id]} maxlength={1000} autocomplete="off" />
							</div>
						{/if}
						{#if r.hint}
							<p class="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
								<InfoIcon class="mt-px size-3.5 shrink-0" />{r.hint}
							</p>
						{/if}
					</li>
				{/each}
			</ul>

			{#if error}<p class="text-sm text-destructive" role="alert">{error}</p>{/if}

			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => prompt.cancel()}>Abbrechen</Button>
				<Button type="submit" disabled={busy || missing.length > 0}>{req?.confirmLabel ?? 'Bestätigen'}</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
