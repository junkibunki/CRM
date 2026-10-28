<script lang="ts">
	import { auth } from '#lib/auth.svelte.js';
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

<form onsubmit={submit}>
	<h1>CRM Anmeldung</h1>
	<label>E-Mail <input type="email" bind:value={email} required autocomplete="username" /></label>
	<label>
		Passwort <input type="password" bind:value={password} required autocomplete="current-password" />
	</label>
	{#if error}<p class="error">{error}</p>{/if}
	<button disabled={busy}>Anmelden</button>
</form>

<style>
	form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		max-width: 320px;
		margin: 15vh auto;
		padding: 2rem;
		background: #fff;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.875rem;
	}
	.error {
		color: #b91c1c;
		margin: 0;
	}
</style>
