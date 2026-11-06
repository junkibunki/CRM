<script lang="ts">
	import type { RecordModel } from 'pocketbase';
	import * as Avatar from '#lib/components/ui/avatar/index.js';
	import { avatarUrl, initials } from './avatar.js';

	let { user, size = 'default', class: className = '' }: { user: RecordModel | null; size?: 'default' | 'sm' | 'lg'; class?: string } =
		$props();

	const src = $derived(avatarUrl(user));
</script>

<Avatar.Root {size} class={className}>
	{#if src}<Avatar.Image {src} alt="" />{/if}
	<Avatar.Fallback class="bg-primary/15 text-xs font-medium text-primary">{initials(user?.name, user?.email)}</Avatar.Fallback>
</Avatar.Root>
