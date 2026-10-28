<script lang="ts">
	// Placeholder for tiles built by later features (F3 activities, F7 to-dos, F12 stage
	// requirements); replaced by the real component when that feature lands.
	import type { Component } from 'svelte';
	import * as Card from '#lib/components/ui/card/index.js';

	type Props = { title: string; text: string; icon: Component<{ class?: string }>; class?: string };
	let { title, text, icon: Icon, class: className }: Props = $props();
</script>

<Card.Root size="sm" class={className} data-placeholder>
	<Card.Header>
		<Card.Title class="flex items-center gap-2">
			<Icon class="size-4 text-muted-foreground" />
			{title}
		</Card.Title>
	</Card.Header>
	<Card.Content>
		<p class="rounded-md border border-dashed px-3 py-6 text-center text-muted-foreground">{text}</p>
	</Card.Content>
</Card.Root>
