<script lang="ts">
	import { auth } from '#lib/auth.svelte.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { AVATAR_TYPES, saveAvatar } from './avatar.js';
	import UserAvatar from './UserAvatar.svelte';

	let input = $state<HTMLInputElement | null>(null);
	let busy = $state(false);
	let error = $state('');

	async function save(file: File | null) {
		busy = true;
		error = (await saveAvatar(file)) ?? '';
		busy = false;
		if (input) input.value = ''; // the same file again must fire `change`
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>Profilbild</Card.Title>
		<Card.Description>Erscheint oben rechts im Benutzermenü. JPG, PNG oder WebP, höchstens 5 MB.</Card.Description>
	</Card.Header>
	<Card.Content class="flex flex-wrap items-center gap-4">
		<UserAvatar user={auth.user} class="size-16" />
		<div class="flex flex-wrap gap-2">
			<input
				bind:this={input}
				type="file"
				accept={AVATAR_TYPES.join(',')}
				class="hidden"
				onchange={(e) => {
					const file = e.currentTarget.files?.[0];
					if (file) save(file);
				}}
			/>
			<Button variant="outline" size="sm" disabled={busy} onclick={() => input?.click()}>
				{auth.user?.avatar ? 'Bild ändern' : 'Bild hochladen'}
			</Button>
			{#if auth.user?.avatar}
				<Button variant="ghost" size="sm" disabled={busy} onclick={() => save(null)}>Entfernen</Button>
			{/if}
		</div>
		{#if error}<p class="w-full text-sm text-destructive" role="alert">{error}</p>{/if}
	</Card.Content>
</Card.Root>
