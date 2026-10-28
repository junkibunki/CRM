<script lang="ts">
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import { createdText, lastUsedText, type ApiToken } from './format';
	import type { TokenStore } from './tokens.svelte';

	type Props = { store: TokenStore; now: Date };
	let { store, now }: Props = $props();

	let confirmOpen = $state(false);
	let target = $state<ApiToken | null>(null);

	function ask(t: ApiToken) {
		target = t;
		confirmOpen = true;
	}
</script>

{#if !store.loaded}
	<p class="text-sm text-muted-foreground">Lädt …</p>
{:else if store.items.length === 0}
	<p class="text-sm text-muted-foreground">Noch keine Tokens.</p>
{:else}
	<Table.Root>
		<Table.Header>
			<Table.Row>
				<Table.Head>Name</Table.Head>
				<Table.Head class="hidden sm:table-cell">Erstellt</Table.Head>
				<Table.Head>Zuletzt genutzt</Table.Head>
				<Table.Head><span class="sr-only">Aktionen</span></Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each store.items as t (t.id)}
				<Table.Row>
					<Table.Cell class="max-w-56 truncate font-medium" title={t.name}>{t.name}</Table.Cell>
					<Table.Cell class="hidden text-muted-foreground sm:table-cell">{createdText(t.created)}</Table.Cell>
					<Table.Cell class="text-muted-foreground">{lastUsedText(t.last_used, now)}</Table.Cell>
					<Table.Cell class="text-right">
						<Button variant="ghost" size="sm" class="text-destructive" onclick={() => ask(t)}>Widerrufen</Button>
					</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>
{/if}

<ConfirmDialog
	bind:open={confirmOpen}
	title="Token widerrufen?"
	description={`„${target?.name ?? ''}“ funktioniert danach nicht mehr; Agents, die ihn nutzen, verlieren den Zugriff.`}
	confirmLabel="Widerrufen"
	onconfirm={() => target && store.revoke(target.id)}
/>
