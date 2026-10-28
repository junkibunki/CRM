<script lang="ts">
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import CopyButton from './CopyButton.svelte';
	import { claudeCommand } from './format';
	import type { NewToken, TokenStore } from './tokens.svelte';

	type Props = { store: TokenStore; url: string };
	let { store, url }: Props = $props();

	let name = $state('');
	let busy = $state(false);
	/** the token just created: shown once, gone with "Fertig" or leaving the page */
	let created = $state<NewToken | null>(null);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (busy || !name.trim()) return;
		busy = true;
		const res = await store.create(name.trim());
		busy = false;
		if (res) {
			created = res;
			name = '';
		}
	}
</script>

{#if created}
	<div class="grid gap-3 rounded-lg border border-primary/40 bg-primary/5 p-4" role="status">
		<p class="text-sm font-medium">
			Token „{created.name}“ erstellt. Kopiere ihn jetzt – er wird <strong>nur einmal</strong> angezeigt.
		</p>
		<div class="flex flex-wrap items-center gap-2">
			<code class="min-w-0 flex-1 rounded bg-muted px-2 py-1.5 font-mono text-xs break-all select-all">{created.token}</code>
			<CopyButton text={created.token} label="Token kopieren" />
		</div>
		<div class="grid gap-1.5">
			<span class="text-xs text-muted-foreground">In Claude Code verbinden (Terminal):</span>
			<div class="flex flex-wrap items-center gap-2">
				<code class="min-w-0 flex-1 rounded bg-muted px-2 py-1.5 font-mono text-xs break-all select-all"
					>{claudeCommand(url, created.token)}</code
				>
				<CopyButton text={claudeCommand(url, created.token)} label="Befehl kopieren" />
			</div>
		</div>
		<div>
			<Button size="sm" onclick={() => (created = null)}>Fertig</Button>
		</div>
	</div>
{:else}
	<form class="flex flex-wrap items-end gap-2" onsubmit={submit}>
		<div class="grid min-w-48 flex-1 gap-1.5">
			<Label for="token-name">Name des neuen Tokens</Label>
			<Input id="token-name" bind:value={name} maxlength={100} placeholder="z. B. Claude Code Laptop" autocomplete="off" />
		</div>
		<Button type="submit" disabled={busy || !name.trim()}><PlusIcon />Token erstellen</Button>
	</form>
{/if}
