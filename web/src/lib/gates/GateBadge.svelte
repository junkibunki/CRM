<script lang="ts">
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';

	/** Warning on a card: the lead stands in a stage whose requirements are not all fulfilled. */
	let { labels }: { labels: string[] } = $props();
	const text = $derived(`Bedingung offen: ${labels.join(', ')}`);
</script>

<p class="mt-1 flex items-center gap-1 truncate text-xs text-amber-700 dark:text-amber-400" title={text}>
	<TriangleAlertIcon class="size-3 shrink-0" />
	<span class="sr-only">{text}</span>
	<span aria-hidden="true" class="truncate">{labels.length === 1 ? labels[0] : `${labels.length} Bedingungen offen`}</span>
</p>
