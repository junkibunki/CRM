<script lang="ts">
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import { untrack } from 'svelte';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/dialog/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { companies } from '#lib/collection.svelte.js';
	import {
		autoLookupDue,
		fetchCompanyLookup,
		lookupLocked,
		lookupChips,
		lookupDomain,
		lookupEmpty,
		lookupErrorMessage,
		type CompanyLookup,
		type LookupField
	} from '#lib/crm/company-lookup.js';
	import { changedFields } from '#lib/diff.js';
	import { deleteErrorMessage, errorMessage } from '#lib/pb.js';
	import type { Company } from '#lib/types.js';

	type Props = {
		/** null = create */
		company: Company | null;
		open: boolean;
		/** initial values for a new company (e.g. name and website from an e-mail domain) */
		prefill?: Partial<typeof empty>;
		/**
		 * new company: load suggestions without the button — right away from a prefilled website
		 * (unknown domain from F9), otherwise when the website field is left with a new domain
		 */
		autoLookup?: boolean;
		onsaved?: (company: Company) => void;
	};
	let { company, open = $bindable(), prefill, autoLookup = false, onsaved }: Props = $props();

	const empty = { name: '', website: '', email: '', phone: '', address: '', notes: '' };
	let form = $state({ ...empty });
	let error = $state('');
	let busy = $state(false);
	let confirmOpen = $state(false);
	// values when the dialog opened; only fields that differ from these are saved, so
	// concurrent edits of other fields by someone else survive
	let initial = { ...empty };

	// suggestions from the company website (F10): loaded on request (or right away for an
	// unknown e-mail domain), offered per field, nothing is taken over without a click
	const domain = $derived(lookupDomain(form.website));
	let lookupBusy = $state(false);
	let lookupError = $state('');
	let lookupResult = $state<CompanyLookup | null>(null);
	let lookupFrom = $state('');
	let lookupSeq = 0; // a newer lookup (or reopening) makes older answers stale
	// results and messages belong to the domain they were loaded for; editing the website
	// hides them until the new domain is loaded
	const lookupCurrent = $derived(!!lookupFrom && lookupFrom === domain);
	const lookupFound = $derived(lookupChips(lookupCurrent ? lookupResult : null, form));
	// a running lookup (up to ≈ 20 s) only blocks the button for its own domain: after editing
	// the website the new one can be loaded at once (the old answer is then dropped)
	const loadingCurrent = $derived(lookupLocked(lookupBusy, lookupFrom, domain));

	function websiteLeft() {
		if (autoLookup && !company && autoLookupDue(domain, lookupFrom)) void loadLookup(domain);
	}

	async function loadLookup(target: string) {
		if (!target) return;
		const seq = ++lookupSeq;
		lookupBusy = true;
		lookupError = '';
		lookupResult = null;
		lookupFrom = target;
		try {
			const res = await fetchCompanyLookup(target);
			if (seq !== lookupSeq) return;
			lookupResult = res;
			if (lookupEmpty(res)) lookupError = `Auf ${target} wurden keine Firmendaten gefunden.`;
		} catch (err) {
			if (seq === lookupSeq) lookupError = lookupErrorMessage(err);
		} finally {
			if (seq === lookupSeq) lookupBusy = false;
		}
	}

	function take(field: LookupField, value: string) {
		form[field] = value;
	}

	$effect(() => {
		if (!open) return;
		untrack(() => {
			lookupSeq++;
			lookupBusy = false;
			lookupError = '';
			lookupResult = null;
			lookupFrom = '';
			form = company
				? {
						name: company.name,
						website: company.website,
						email: company.email,
						phone: company.phone,
						address: company.address,
						notes: company.notes
					}
				: { ...empty, ...prefill };
			initial = { ...form };
			error = '';
			if (!company && autoLookup) void loadLookup(lookupDomain(form.website));
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

{#snippet suggestion(field: LookupField)}
	{@const value = lookupFound[field]}
	{#if value}
		<div class="flex flex-wrap gap-1">
			<Button
				type="button"
				variant="outline"
				size="xs"
				class="h-auto min-h-6 max-w-full py-0.5 text-left whitespace-normal break-words"
				title="Vorschlag von {lookupFrom} übernehmen"
				onclick={() => take(field, value)}
			>
				<GlobeIcon />{value}
			</Button>
		</div>
	{/if}
{/snippet}

<Dialog.Root bind:open>
	<!-- suggestion chips make the form taller: scroll inside on small screens -->
	<Dialog.Content class="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
		<form class="flex flex-col gap-4" onsubmit={save}>
			<Dialog.Header>
				<Dialog.Title>{company ? 'Unternehmen bearbeiten' : 'Neues Unternehmen'}</Dialog.Title>
			</Dialog.Header>

			<div class="grid gap-1.5">
				<Label for="co-name">Name</Label>
				<Input id="co-name" bind:value={form.name} required maxlength={200} />
				{@render suggestion('name')}
			</div>
			<div class="grid grid-cols-2 gap-4">
				<div class="grid content-start gap-1.5">
					<Label for="co-web">Website</Label>
					<Input id="co-web" type="url" bind:value={form.website} placeholder="https://" onblur={websiteLeft} />
					{@render suggestion('website')}
				</div>
				<div class="grid content-start gap-1.5">
					<Label for="co-phone">Telefon</Label>
					<Input id="co-phone" bind:value={form.phone} maxlength={50} />
					{@render suggestion('phone')}
				</div>
			</div>
			{#if domain || loadingCurrent}
				<div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" aria-live="polite">
					{#if domain}
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={loadingCurrent}
							onclick={() => loadLookup(domain)}
						>
							{#if loadingCurrent}<LoaderCircleIcon class="animate-spin" />{:else}<GlobeIcon />{/if}
							Daten von {domain} laden
						</Button>
					{/if}
					{#if loadingCurrent}
						<span class="text-muted-foreground">Lade Daten von {lookupFrom} …</span>
					{:else if lookupCurrent && lookupError}
						<span class="text-muted-foreground">{lookupError}</span>
					{:else if lookupCurrent && lookupResult}
						<span class="text-muted-foreground break-all" title={lookupResult.source}>
							{Object.keys(lookupFound).length
								? 'Vorschläge per Klick übernehmen'
								: 'Alle gefundenen Daten sind schon eingetragen'}
							(Quelle: {lookupResult.source.replace(/^https:\/\//, '')})
						</span>
					{/if}
				</div>
			{/if}
			<div class="grid gap-1.5">
				<Label for="co-email">E-Mail</Label>
				<Input id="co-email" type="email" bind:value={form.email} />
				{@render suggestion('email')}
			</div>
			<div class="grid gap-1.5">
				<Label for="co-address">Adresse</Label>
				<Textarea id="co-address" bind:value={form.address} rows={2} maxlength={1000} />
				{@render suggestion('address')}
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
