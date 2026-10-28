<script lang="ts">
	import { untrack } from 'svelte';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { companies, companyName, contacts } from '#lib/collection.svelte.js';
	import { changedFields } from '#lib/diff.js';
	import { deleteErrorMessage, errorMessage } from '#lib/pb.js';
	import { contactName, type Contact } from '#lib/types.js';

	type Props = {
		/** null = create */
		contact: Contact | null;
		open: boolean;
		/** preselected company for a new contact */
		company?: string;
		onsaved?: (contact: Contact) => void;
	};
	let { contact, open = $bindable(), company = '', onsaved }: Props = $props();

	const empty = {
		first_name: '',
		last_name: '',
		company: '',
		position: '',
		email: '',
		phone: '',
		notes: ''
	};
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
			form = contact
				? {
						first_name: contact.first_name,
						last_name: contact.last_name,
						company: contact.company,
						position: contact.position,
						email: contact.email,
						phone: contact.phone,
						notes: contact.notes
					}
				: { ...empty, company };
			initial = { ...form };
			error = '';
		});
	});

	async function save(e: SubmitEvent) {
		e.preventDefault();
		if (!form.last_name.trim() || busy) return;
		busy = true;
		error = '';
		try {
			const data = { ...form, first_name: form.first_name.trim(), last_name: form.last_name.trim() };
			let rec = contact;
			if (!contact) rec = await contacts.create(data);
			else {
				const changed = changedFields(initial, data);
				if (Object.keys(changed).length) rec = await contacts.update(contact.id, changed);
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
		if (!contact) return;
		try {
			await contacts.delete(contact.id);
			open = false;
		} catch (err) {
			error = deleteErrorMessage(err, 'noch ein Lead (als einziger Kontakt)');
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-lg">
		<form class="flex flex-col gap-4" onsubmit={save}>
			<Dialog.Header>
				<Dialog.Title>{contact ? 'Kontakt bearbeiten' : 'Neuer Kontakt'}</Dialog.Title>
			</Dialog.Header>

			<div class="grid grid-cols-2 gap-4">
				<div class="grid gap-1.5">
					<Label for="ct-first">Vorname</Label>
					<Input id="ct-first" bind:value={form.first_name} maxlength={100} />
				</div>
				<div class="grid gap-1.5">
					<Label for="ct-last">Nachname</Label>
					<Input id="ct-last" bind:value={form.last_name} required maxlength={100} />
				</div>
			</div>
			<div class="grid grid-cols-2 gap-4">
				<div class="grid gap-1.5">
					<Label>Unternehmen</Label>
					<Select.Root type="single" bind:value={form.company}>
						<Select.Trigger class="w-full">{companyName(form.company) || 'Keins'}</Select.Trigger>
						<Select.Content>
							<Select.Item value="" label="Keins" />
							{#each companies.list as c (c.id)}
								<Select.Item value={c.id} label={c.name} />
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
				<div class="grid gap-1.5">
					<Label for="ct-pos">Position</Label>
					<Input id="ct-pos" bind:value={form.position} maxlength={100} />
				</div>
			</div>
			<div class="grid grid-cols-2 gap-4">
				<div class="grid gap-1.5">
					<Label for="ct-email">E-Mail</Label>
					<Input id="ct-email" type="email" bind:value={form.email} />
				</div>
				<div class="grid gap-1.5">
					<Label for="ct-phone">Telefon</Label>
					<Input id="ct-phone" bind:value={form.phone} maxlength={50} />
				</div>
			</div>
			<div class="grid gap-1.5">
				<Label for="ct-notes">Notizen</Label>
				<Textarea id="ct-notes" bind:value={form.notes} rows={3} />
			</div>

			{#if error}<p class="text-sm text-destructive">{error}</p>{/if}

			<Dialog.Footer class="sm:justify-between">
				{#if contact}
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
	title="Kontakt löschen?"
	description="„{contact ? contactName(contact) : ''}“ wird endgültig gelöscht und aus allen Leads entfernt, in denen weitere Kontakte stehen."
	onconfirm={remove}
/>
