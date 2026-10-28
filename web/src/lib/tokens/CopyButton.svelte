<script lang="ts">
	import CheckIcon from '@lucide/svelte/icons/check';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import { Button } from '#lib/components/ui/button/index.js';

	type Props = { text: string; label?: string };
	let { text, label = 'Kopieren' }: Props = $props();

	let copied = $state(false);
	let failed = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => () => clearTimeout(timer));

	async function copy() {
		failed = false;
		try {
			await navigator.clipboard.writeText(text);
			copied = true;
			clearTimeout(timer);
			timer = setTimeout(() => (copied = false), 2000);
		} catch {
			// no clipboard (http without localhost, permission): the text is selectable
			failed = true;
		}
	}
</script>

<Button variant="outline" size="sm" onclick={copy} aria-live="polite">
	{#if copied}<CheckIcon />Kopiert{:else}<CopyIcon />{label}{/if}
</Button>
{#if failed}<span class="text-xs text-destructive">Kopieren nicht möglich – bitte markieren.</span>{/if}
