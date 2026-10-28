<script lang="ts">
	import { auth } from '#lib/auth.svelte.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { goto } from '$app/navigation';

	let email = $state('');
	let password = $state('');
	let error = $state('');
	let busy = $state(false);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		error = '';
		try {
			await auth.login(email, password);
			goto('/');
		} catch {
			error = 'Anmeldung fehlgeschlagen.';
		} finally {
			busy = false;
		}
	}
</script>

<div class="flex min-h-dvh items-center justify-center p-4">
	<Card.Root class="w-full max-w-sm">
		<!-- the form carries the card's spacing, see docs/pitfalls/designsystem.md -->
		<form class="flex flex-col gap-(--card-spacing)" onsubmit={submit}>
			<Card.Header>
				<Card.Title>CRM Anmeldung</Card.Title>
			</Card.Header>
			<Card.Content class="grid gap-4">
				<div class="grid gap-1.5">
					<Label for="email">E-Mail</Label>
					<Input id="email" type="email" bind:value={email} required autocomplete="username" />
				</div>
				<div class="grid gap-1.5">
					<Label for="password">Passwort</Label>
					<Input
						id="password"
						type="password"
						bind:value={password}
						required
						autocomplete="current-password"
					/>
				</div>
				{#if error}<p class="text-sm text-destructive">{error}</p>{/if}
			</Card.Content>
			<Card.Footer>
				<Button type="submit" class="w-full" disabled={busy}>Anmelden</Button>
			</Card.Footer>
		</form>
	</Card.Root>
</div>
