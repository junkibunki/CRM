<script lang="ts">
	import type { Snippet } from 'svelte';
	import SearchIcon from '@lucide/svelte/icons/search';
	import { Input } from '#lib/components/ui/input/index.js';

	type Props = { title: string; search?: string; actions?: Snippet };
	let { title, search = $bindable(), actions }: Props = $props();
</script>

<div class="mb-4 flex flex-wrap items-center gap-3">
	<h1 class="mr-auto text-xl font-semibold">{title}</h1>
	{#if search !== undefined}
		<div class="relative w-64">
			<SearchIcon
				class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
			/>
			<Input bind:value={search} placeholder="Suchen …" class="pl-8" aria-label="Suchen" />
		</div>
	{/if}
	{@render actions?.()}
</div>
