<script module lang="ts">
	import type { DueStatus } from './types';

	// full class names so Tailwind finds them
	export const DUE_TONE: Record<DueStatus, string> = {
		overdue: 'bg-destructive/10 text-destructive',
		today: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300',
		future: 'text-muted-foreground'
	};
	export const DUE_TEXT: Record<DueStatus, string> = {
		overdue: 'überfällig',
		today: 'heute fällig',
		future: 'fällig'
	};
</script>

<script lang="ts">
	import ListTodoIcon from '@lucide/svelte/icons/list-todo';
	import { cn } from '#lib/utils.js';
	import { clock } from './clock.svelte';
	import { dueStatus, formatDue } from './due';
	import type { OpenTodo } from './types';

	/** The next to-do on a card; without one a quiet hint, except in closed stages. */
	type Props = { todo?: OpenTodo; closed?: boolean };
	let { todo, closed = false }: Props = $props();

	const status = $derived(todo ? dueStatus(todo, clock.now) : null);
	const label = $derived(todo ? formatDue(todo, clock.now) : '');
</script>

{#if todo && status}
	<p
		class="mt-1.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
		title="Nächstes To-Do ({DUE_TEXT[status]} {label}): {todo.title}"
	>
		<ListTodoIcon class="size-3 shrink-0" />
		<span
			class={cn(
				'shrink-0 rounded px-1 font-medium tabular-nums',
				status === 'future' && 'px-0',
				DUE_TONE[status]
			)}
		>
			<span class="sr-only">Nächstes To-Do, {DUE_TEXT[status]}:</span>
			{label}
		</span>
		<span class="min-w-0 truncate">{todo.title}</span>
	</p>
{:else if !closed}
	<p class="mt-1.5 text-xs text-muted-foreground/70">Kein nächster Schritt</p>
{/if}
