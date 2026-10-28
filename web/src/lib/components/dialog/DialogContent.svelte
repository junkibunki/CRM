<script lang="ts">
	import XIcon from '@lucide/svelte/icons/x';
	import { Dialog as DialogPrimitive } from 'bits-ui';
	import type { ComponentProps } from 'svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Content } from '#lib/components/ui/dialog/index.js';

	/**
	 * shadcn's Dialog.Content with a German close button: the generated one says "Close" to
	 * screen readers. Same look; the CLI file stays untouched (designsystem.md).
	 */
	let {
		ref = $bindable(null),
		children,
		showCloseButton = true,
		...rest
	}: ComponentProps<typeof Content> = $props();
</script>

<Content bind:ref showCloseButton={false} {...rest}>
	{@render children?.()}
	{#if showCloseButton}
		<DialogPrimitive.Close data-slot="dialog-close">
			{#snippet child({ props })}
				<Button variant="ghost" class="absolute top-4 right-4" size="icon-sm" {...props}>
					<XIcon />
					<span class="sr-only">Schließen</span>
				</Button>
			{/snippet}
		</DialogPrimitive.Close>
	{/if}
</Content>
