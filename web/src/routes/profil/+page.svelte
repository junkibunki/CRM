<script lang="ts">
	import XIcon from '@lucide/svelte/icons/x';
	import { auth } from '#lib/auth.svelte.js';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import CopyButton from '#lib/tokens/CopyButton.svelte';
	import { claudeCommand, jsonConfig, mcpUrl } from '#lib/tokens/format.js';
	import TokenCreate from '#lib/tokens/TokenCreate.svelte';
	import TokenList from '#lib/tokens/TokenList.svelte';
	import { TokenStore } from '#lib/tokens/tokens.svelte.js';

	const store = new TokenStore();
	$effect(() => store.use());

	// "zuletzt genutzt" is relative: tick once a minute
	let now = $state(new Date());
	$effect(() => {
		const t = setInterval(() => (now = new Date()), 60_000);
		return () => clearInterval(t);
	});

	const url = mcpUrl(location.origin);
	const placeholder = 'crm_…';
	const userLine = $derived([auth.user?.name, auth.user?.email].filter(Boolean).join(' · '));
</script>

<svelte:head><title>Profil – CRM</title></svelte:head>

<div class="h-full overflow-y-auto">
	<div class="mx-auto grid max-w-3xl gap-6 p-4 sm:p-6">
		<div>
			<PageHeader title="Profil" />
			<p class="-mt-2 text-sm text-muted-foreground">Angemeldet als {userLine}</p>
		</div>

		{#if store.error}
			<div
				class="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
				role="alert"
			>
				<span class="flex-1">{store.error}</span>
				<Button variant="ghost" size="icon-xs" aria-label="Meldung schließen" onclick={() => store.clearError()}>
					<XIcon />
				</Button>
			</div>
		{/if}

		<Card.Root>
			<Card.Header>
				<Card.Title>API-Tokens für Agents</Card.Title>
				<Card.Description>
					Mit einem persönlichen Token greifen Agents (Claude Code, Claude Desktop u. a.) über den MCP-Server
					<strong>lesend</strong> auf das CRM zu – mit deinen Rechten, als du. Behandle ihn wie ein Passwort und
					widerrufe ihn, wenn du ihn nicht mehr brauchst. Eine Änderung deines Passworts widerruft alle Tokens.
				</Card.Description>
			</Card.Header>
			<Card.Content class="grid gap-5">
				<TokenCreate {store} {url} />
				<TokenList {store} {now} />
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header>
				<Card.Title>Claude Code verbinden</Card.Title>
				<Card.Description>Einmal pro Rechner, mit einem eigenen Token je Gerät.</Card.Description>
			</Card.Header>
			<Card.Content class="grid gap-4 text-sm">
				<dl class="grid gap-x-4 gap-y-1 sm:grid-cols-[max-content_1fr]">
					<dt class="text-muted-foreground">URL</dt>
					<dd class="flex flex-wrap items-center gap-2">
						<code class="rounded bg-muted px-1.5 py-0.5 font-mono text-xs break-all">{url}</code>
						<CopyButton text={url} label="URL kopieren" />
					</dd>
					<dt class="text-muted-foreground">Header</dt>
					<dd><code class="rounded bg-muted px-1.5 py-0.5 font-mono text-xs break-all">Authorization: Bearer {placeholder}</code></dd>
				</dl>
				<div class="grid gap-1.5">
					<p>Im Terminal (den Token nach dem Erstellen oben einsetzen, dort steht der fertige Befehl):</p>
					<pre class="overflow-x-auto rounded bg-muted p-2 font-mono text-xs">{claudeCommand(url, placeholder)}</pre>
				</div>
				<div class="grid gap-1.5">
					<p>Oder als Eintrag in <code class="font-mono text-xs">.mcp.json</code> bzw. für andere MCP-Clients:</p>
					<pre class="overflow-x-auto rounded bg-muted p-2 font-mono text-xs">{jsonConfig(url, placeholder)}</pre>
				</div>
				<p class="text-muted-foreground">
					Danach in Claude Code mit <code class="font-mono text-xs">/mcp</code> prüfen. Werkzeuge: Suche, Lead, Unternehmen,
					Kontakt, Pipeline, Aktivitäten, Meine To-Dos; dazu Vorlagen wie „Lead-Briefing“, „Wochenbericht“, „Leads ohne
					nächsten Schritt“ und „Meeting nachbereiten“ (als <code class="font-mono text-xs">/mcp__crm__…</code>).
					Version 1 kann nur lesen – nichts anlegen, ändern oder löschen.
				</p>
			</Card.Content>
		</Card.Root>
	</div>
</div>
