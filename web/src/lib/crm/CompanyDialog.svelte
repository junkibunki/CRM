<script lang="ts">
	import { untrack } from 'svelte';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { companies } from '#lib/collection.svelte.js';
	import { changedFields } from '#lib/diff.js';
	import { deleteErrorMessage, errorMessage } from '#lib/pb.js';
	import type { Company } from '#lib/types.js';

	type Props = {
		/** null = create */
		company: Company | null;
		open: boolean;
		onsaved?: (company: Company) => void;
	};
	let { company, open = $bindable(), onsaved }: Props = $props();

	const empty = { name: '', website: '', email: '', phone: '', address: '', notes: '' };
	let form = $state({ ...empty });
	let error = $state('');
	let busy = $state(false);
	let confirmOpen = $state(false);
	// values when the dialog opened; only fields that differ from these are saved, so
	// concurrent edits of other fields by someone else survive
	let initial = { ...empty };

	$effect(() => {
		if (!open) return;
		untrack(() => {
			form = company
				? {
						name: company.name,
						website: company.website,
						email: company.email,
						phone: company.phone,
						address: company.address,
						notes: company.notes
					}
				: { ...empty };
			initial = { ...form };
			error = '';
		});
	});

	async function save(e: SubmitEvent) {
		e.preventDefault();
		if (!form.name.trim() || busy) return;
		busy = true;
		error = '';
		try {
			const data = { ...form, name: form.name.trim() };
			let rec = company;
			if (!company) rec = await companies.create(data);
			else {
				const changed = changedFields(initial, data);
				if (Object.keys(changed).length) rec = await companies.update(company.id, changed);
			}
			open = false;
			if (rec) onsaved?.(rec);
		} catch (err) {
			error = errorMessage(err);
		} finally {
			busy = false;
		}
	}

	async function remove() {
		if (!company) return;
		try {
			await companies.delete(company.id);
			open = false;
		} catch (err) {
			error = deleteErrorMessage(err, 'noch ein Lead');
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-lg">
		<form class="flex flex-col gap-4" onsubmit={save}>
			<Dialog.Header>
				<Dialog.Title>{company ? 'Unternehmen bearbeiten' : 'Neues Unternehmen'}</Dialog.Title>
			</Dialog.Header>

			<div class="grid gap-1.5">
				<Label for="co-name">Name</Label>
				<Input id="co-name" bind:value={form.name} required maxlength={200} />
			</div>
			<div class="grid grid-cols-2 gap-4">
				<div class="grid gap-1.5">
					<Label for="co-web">Website</Label>
					<Input id="co-web" type="url" bind:value={form.website} placeholder="https://" />
				</div>
				<div class="grid gap-1.5">
					<Label for="co-phone">Telefon</Label>
					<Input id="co-phone" bind:value={form.phone} maxlength={50} />
				</div>
			</div>
			<div class="grid gap-1.5">
				<Label for="co-email">E-Mail</Label>
				<Input id="co-email" type="email" bind:value={form.email} />
			</div>
			<div class="grid gap-1.5">
				<Label for="co-address">Adresse</Label>
				<Textarea id="co-address" bind:value={form.address} rows={2} maxlength={1000} />
			</div>
			<div class="grid gap-1.5">
				<Label for="co-notes">Notizen</Label>
				<Textarea id="co-notes" bind:value={form.notes} rows={3} />
			</div>

			{#if error}<p class="text-sm text-destructive">{error}</p>{/if}

			<Dialog.Footer class="sm:justify-between">
				{#if company}
					<Button type="button" variant="ghost" onclick={() => (confirmOpen = true)}>Löschen</Button>
				{:else}
					<span></span>
				{/if}
				<div class="flex gap-2">
					<Button type="button" variant="outline" onclick={() => (open = false)}>Abbrechen</Button>
					<Button type="submit" disabled={busy}>Speichern</Button>
				</div>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<ConfirmDialog
	bind:open={confirmOpen}
	title="Unternehmen löschen?"
	description="„{company?.name}“ wird endgültig gelöscht. Zugeordnete Kontakte bleiben erhalten."
	onconfirm={remove}
/>
