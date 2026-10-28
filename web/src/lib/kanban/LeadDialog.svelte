<script lang="ts">
	import { untrack } from 'svelte';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/dialog/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import { auth } from '#lib/auth.svelte.js';
	import type { LeadWriter } from '#lib/lead/lead.svelte.js';
	import {
		companies,
		companyName,
		contactLabel,
		contacts,
		userLabel,
		users
	} from '#lib/collection.svelte.js';
	import CompanyDialog from '#lib/crm/CompanyDialog.svelte';
	import ContactDialog from '#lib/crm/ContactDialog.svelte';
	import { changedFields } from '#lib/diff.js';
	import GateDialog from '#lib/gates/GateDialog.svelte';
	import type { GateStore } from '#lib/gates/gates.svelte.js';
	import { GATES_LOADING, GatePrompt, createPlan } from '#lib/gates/prompt.svelte.js';
	import {
		fromDateInput,
		toDateInput,
		type BoardColumn,
		type Lead,
		type LeadData
	} from '#lib/types.js';

	type Props = {
		/** BoardStore on the board, LeadStore on the detail page */
		store: LeadWriter;
		/** existing lead to edit, or null to create one in `column` */
		lead: Lead | null;
		column: BoardColumn | null;
		open: boolean;
		/** F12: a new lead in a stage with requirements is confirmed first (gate dialog) */
		gates?: GateStore;
		/** the pipeline's stages (for the cumulative requirements) */
		columns?: BoardColumn[];
	};
	let { store, lead, column, open = $bindable(), gates, columns }: Props = $props();
	const gatePrompt = new GatePrompt();

	let form = $state({
		title: '',
		company: '',
		contacts: [] as string[],
		expected_close: '',
		owner: ''
	});
	let error = $state('');
	let busy = $state(false);
	let confirmOpen = $state(false);
	let companyOpen = $state(false);
	let contactOpen = $state(false);
	// values when the dialog opened; only fields that differ from these are saved
	let initial: LeadData | null = null;

	// (re)fill only when the dialog opens, so realtime updates don't overwrite typing
	$effect(() => {
		if (!open) return;
		const l = lead;
		untrack(() => {
			form = l
				? {
						title: l.title,
						company: l.company,
						contacts: [...l.contacts],
						expected_close: toDateInput(l.expected_close),
						owner: l.owner
					}
				: { title: '', company: '', contacts: [], expected_close: '', owner: auth.user?.id ?? '' };
			initial = l ? toData() : null;
			error = '';
		});
	});

	function toData(): LeadData {
		return {
			title: form.title.trim(),
			company: form.company,
			contacts: [...form.contacts],
			expected_close: fromDateInput(form.expected_close),
			owner: form.owner
		};
	}

	// contacts of the chosen company, plus any already selected from elsewhere
	const contactOptions = $derived(
		contacts.list.filter((c) => c.company === form.company || form.contacts.includes(c.id))
	);

	const created = $derived(
		lead
			? new Date(lead.created.replace(' ', 'T')).toLocaleString('de-DE', {
					dateStyle: 'medium',
					timeStyle: 'short'
				})
			: ''
	);

	function validate() {
		if (!form.title.trim()) return 'Bitte einen Titel angeben.';
		if (!form.company) return 'Bitte ein Unternehmen wählen.';
		if (form.contacts.length === 0) return 'Bitte mindestens einen Kontakt wählen.';
		if (!form.owner) return 'Bitte einen zuständigen Mitarbeiter wählen.';
		return '';
	}

	async function save(e: SubmitEvent) {
		e.preventDefault();
		error = validate();
		if (error || busy) return;
		const data = toData();
		if (lead) {
			open = false;
			// only what was changed here, so concurrent edits of other fields survive; contacts
			// go as the difference to `initial`, so a contact someone else added stays
			const changed = initial ? changedFields(initial, data) : data;
			if (Object.keys(changed).length) store.updateLead(lead.id, changed, initial ?? undefined); // optimistic
			return;
		}
		if (!column) return;
		const target = column;
		// a stage with requirements (its own or earlier ones): confirm them first; lead and
		// confirmations are then created together (POST /api/crm/leads)
		const plan = createPlan(gates, columns, target.id);
		if (plan.kind === 'wait') {
			error = GATES_LOADING;
			return;
		}
		if (plan.kind === 'gate') {
			gatePrompt.ask({
				title: `Bevor „${data.title}“ nach „${target.name}“ kann`,
				description: 'Der neue Lead kommt in eine Phase mit Bedingungen:',
				requirements: plan.requirements,
				confirmLabel: 'Bestätigen und anlegen',
				run: async (entries) => {
					const ok = await store.addLead(target.id, data, entries);
					if (!ok) return store.error;
					open = false;
					return null;
				}
			});
			return;
		}
		busy = true;
		const ok = await store.addLead(column.id, data);
		busy = false;
		if (ok) open = false;
		else error = store.error;
	}

	function remove() {
		if (!lead) return;
		open = false;
		store.deleteLead(lead.id);
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-lg">
		<form class="flex flex-col gap-4" onsubmit={save}>
			<Dialog.Header>
				<Dialog.Title>{lead ? 'Lead bearbeiten' : `Neuer Lead in „${column?.name ?? ''}“`}</Dialog.Title>
				{#if lead}<Dialog.Description>Erstellt am {created}</Dialog.Description>{/if}
			</Dialog.Header>

			<div class="grid gap-1.5">
				<Label for="lead-title">Titel</Label>
				<Input id="lead-title" bind:value={form.title} required maxlength={300} />
			</div>

			<div class="grid gap-1.5">
				<div class="flex items-center justify-between">
					<Label>Unternehmen</Label>
					<Button type="button" variant="ghost" size="xs" onclick={() => (companyOpen = true)}>
						<PlusIcon /> Neu
					</Button>
				</div>
				<Select.Root type="single" bind:value={form.company}>
					<Select.Trigger class="w-full">{companyName(form.company) || 'Bitte wählen'}</Select.Trigger>
					<Select.Content>
						{#each companies.list as c (c.id)}
							<Select.Item value={c.id} label={c.name} />
						{:else}
							<p class="px-2 py-1.5 text-sm text-muted-foreground">Noch keine Unternehmen.</p>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>

			<div class="grid gap-1.5">
				<div class="flex items-center justify-between">
					<Label>Kontakte</Label>
					<Button
						type="button"
						variant="ghost"
						size="xs"
						disabled={!form.company}
						onclick={() => (contactOpen = true)}
					>
						<PlusIcon /> Neu
					</Button>
				</div>
				<Select.Root type="multiple" bind:value={form.contacts}>
					<Select.Trigger class="w-full" disabled={!form.company}>
						<span class="truncate">
							{form.contacts.map(contactLabel).join(', ') ||
								(form.company ? 'Bitte wählen' : 'Erst ein Unternehmen wählen')}
						</span>
					</Select.Trigger>
					<Select.Content>
						{#each contactOptions as c (c.id)}
							<Select.Item value={c.id} label={contactLabel(c.id)} />
						{:else}
							<p class="px-2 py-1.5 text-sm text-muted-foreground">
								Keine Kontakte bei diesem Unternehmen.
							</p>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>

			<div class="grid grid-cols-2 gap-4">
				<div class="grid gap-1.5">
					<Label for="lead-close">Voraussichtlicher Abschluss</Label>
					<Input id="lead-close" type="date" bind:value={form.expected_close} />
				</div>
				<div class="grid gap-1.5">
					<Label>Zuständig</Label>
					<Select.Root type="single" bind:value={form.owner}>
						<Select.Trigger class="w-full">{userLabel(form.owner) || 'Bitte wählen'}</Select.Trigger>
						<Select.Content>
							{#each users.list as u (u.id)}
								<Select.Item value={u.id} label={userLabel(u.id)} />
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
			</div>

			{#if error}<p class="text-sm text-destructive">{error}</p>{/if}

			<Dialog.Footer class="sm:justify-between">
				{#if lead}
					<Button type="button" variant="ghost" onclick={() => (confirmOpen = true)}>Löschen</Button>
				{:else}
					<span></span>
				{/if}
				<div class="flex gap-2">
					<Button type="button" variant="outline" onclick={() => (open = false)}>Abbrechen</Button>
					<Button type="submit" disabled={busy}>{lead ? 'Speichern' : 'Anlegen'}</Button>
				</div>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<GateDialog prompt={gatePrompt} />

<ConfirmDialog
	bind:open={confirmOpen}
	title="Lead löschen?"
	description="„{lead?.title}“ wird endgültig gelöscht."
	onconfirm={remove}
/>

<!-- autoLookup: website data load by themselves once the website is entered (as from the contact dialog) -->
<CompanyDialog
	company={null}
	autoLookup
	bind:open={companyOpen}
	onsaved={(c) => {
		form.company = c.id;
		form.contacts = [];
	}}
/>

<ContactDialog
	contact={null}
	company={form.company}
	bind:open={contactOpen}
	onsaved={(c) => (form.contacts = [...form.contacts, c.id])}
/>
