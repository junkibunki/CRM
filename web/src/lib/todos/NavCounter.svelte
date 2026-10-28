<script lang="ts">
	import { auth } from '#lib/auth.svelte.js';
	import { cn } from '#lib/utils.js';
	import { clock } from './clock.svelte';
	import { countDue } from './groups';
	import { myTodos } from './mine.svelte';

	// keeps the shared source running while the navigation is shown (the page reuses it)
	$effect(() => myTodos.use());

	const count = $derived(countDue(myTodos.list(auth.user?.id ?? ''), clock.now));
	const total = $derived(count.overdue + count.today);
	const text = $derived(
		[count.overdue && `${count.overdue} überfällig`, count.today && `${count.today} heute fällig`]
			.filter(Boolean)
			.join(', ')
	);
</script>

{#if total > 0}
	<span
		class={cn(
			'ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-xs leading-5 font-medium tabular-nums',
			count.overdue
				? 'bg-destructive text-white'
				: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300'
		)}
		title={text}
	>
		{total}<span class="sr-only">: {text}</span>
	</span>
{/if}
