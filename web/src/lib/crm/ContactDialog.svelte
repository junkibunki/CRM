<script lang="ts">
	import Building2Icon from '@lucide/svelte/icons/building-2';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { untrack } from 'svelte';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { companies, companyName, contacts } from '#lib/collection.svelte.js';
	import CompanyDialog from '#lib/crm/CompanyDialog.svelte';
	import { suggestFromEmail, visibleSuggestions, type Chip } from '#lib/crm/email-suggest.js';
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

	// suggestions from the e-mail address (F9): computed when the field is left or after a
	// typing pause, shown as chips only for fields that are still empty
	let checkedEmail = $state('');
	let emailTimer: ReturnType<typeof setTimeout> | undefined;
	const suggestion = $derived(checkedEmail ? suggestFromEmail(checkedEmail, companies.list) : null);
	let companyOpen = $state(false);
	let companyPrefill = $state<{ name: string; website: string }>({ name: '', website: '' });

	function checkEmail(delay = 0) {
		clearTimeout(emailTimer);
		if (delay) emailTimer = setTimeout(() => (checkedEmail = form.email), delay);
		else checkedEmail = form.email;
	}

	// only for empty fields; a chosen company (e.g. the lead's) wins over the domain
	const visible = $derived(visibleSuggestions(suggestion, form));
	const firstChips = $derived(visible.first_name);
	const lastChips = $derived(visible.last_name);
	const companyChip = $derived(visible.company);

	function createCompany() {
		if (companyChip?.kind !== 'new') return;
		companyPrefill = { name: companyChip.name, website: companyChip.website };
		companyOpen = true;
	}

	$effect(() => () => clearTimeout(emailTimer));

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
			clearTimeout(emailTimer);
			checkedEmail = '';
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

{#snippet chips(list: Chip[], take: (value: string) => void)}
	{#if list.length}
		<div class="flex flex-wrap gap-1">
			{#each list as chip (chip.label)}
				<Button
					type="button"
					variant="outline"
					size="xs"
					title="Vorschlag aus der E-Mail-Adresse übernehmen"
					onclick={() => take(chip.value)}>{chip.label}</Button
				>
			{/each}
		</div>
	{/if}
{/snippet}

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-lg">
		<form class="flex flex-col gap-4" onsubmit={save}>
			<Dialog.Header>
				<Dialog.Title>{contact ? 'Kontakt bearbeiten' : 'Neuer Kontakt'}</Dialog.Title>
			</Dialog.Header>

			<div class="grid gap-1.5">
				<Label for="ct-email">E-Mail</Label>
				<Input
					id="ct-email"
					type="email"
					bind:value={form.email}
					oninput={() => checkEmail(600)}
					onblur={() => checkEmail()}
				/>
			</div>
			<div class="grid grid-cols-2 gap-4">
				<div class="grid content-start gap-1.5">
					<Label for="ct-first">Vorname</Label>
					<Input id="ct-first" bind:value={form.first_name} maxlength={100} />
					{@render chips(firstChips, (v) => (form.first_name = v))}
				</div>
				<div class="grid content-start gap-1.5">
					<Label for="ct-last">Nachname</Label>
					<Input id="ct-last" bind:value={form.last_name} required maxlength={100} />
					{@render chips(lastChips, (v) => (form.last_name = v))}
				</div>
			</div>
			<div class="grid grid-cols-2 gap-4">
				<div class="grid content-start gap-1.5">
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
					{#if companyChip?.kind === 'existing'}
						{@const c = companyChip}
						<div class="flex flex-wrap gap-1">
							<Button
								type="button"
								variant="outline"
								size="xs"
								class="h-auto min-h-6 py-0.5 text-left whitespace-normal"
								title={c.match === 'website'
									? 'Vorhandenes Unternehmen mit dieser Domain übernehmen'
									: 'Vorhandenes Unternehmen mit passendem Namen übernehmen'}
								onclick={() => (form.company = c.id)}
							>
								<Building2Icon />{c.name}
							</Button>
						</div>
					{:else if companyChip?.kind === 'new'}
						<div class="flex flex-wrap gap-1">
							<Button
								type="button"
								variant="outline"
								size="xs"
								class="h-auto min-h-6 py-0.5 text-left whitespace-normal break-all"
								title="Unternehmen „{companyChip.name}“ mit Website {companyChip.website} anlegen"
								onclick={createCompany}
							>
								<PlusIcon />Neues Unternehmen anlegen: {companyChip.domain}
							</Button>
						</div>
					{/if}
				</div>
				<div class="grid gap-1.5">
					<Label for="ct-pos">Position</Label>
					<Input id="ct-pos" bind:value={form.position} maxlength={100} />
				</div>
			</div>
			<div class="grid gap-1.5">
				<Label for="ct-phone">Telefon</Label>
				<Input id="ct-phone" bind:value={form.phone} maxlength={50} />
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

<CompanyDialog
	company={null}
	prefill={companyPrefill}
	bind:open={companyOpen}
	onsaved={(c) => (form.company = c.id)}
/>

<ConfirmDialog
	bind:open={confirmOpen}
	title="Kontakt löschen?"
	description="„{contact ? contactName(contact) : ''}“ wird endgültig gelöscht und aus allen Leads entfernt, in denen weitere Kontakte stehen."
	onconfirm={remove}
/>
