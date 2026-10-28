<script lang="ts" module>
	import InboxIcon from '@lucide/svelte/icons/inbox';
	import NotebookPenIcon from '@lucide/svelte/icons/notebook-pen';
	import SendIcon from '@lucide/svelte/icons/send';
	import UsersIcon from '@lucide/svelte/icons/users';
	import type { ActivityType } from './types';

	// full class names so Tailwind finds them
	export const TYPE_STYLE: Record<ActivityType, { icon: typeof InboxIcon; tone: string; people: string }> = {
		note: { icon: NotebookPenIcon, tone: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300', people: 'Kontakte' },
		meeting: { icon: UsersIcon, tone: 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300', people: 'Teilnehmer' },
		email_in: { icon: InboxIcon, tone: 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300', people: 'Von' },
		email_out: { icon: SendIcon, tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300', people: 'An' }
	};
</script>

<script lang="ts">
	import ImageOffIcon from '@lucide/svelte/icons/image-off';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import ListPlusIcon from '@lucide/svelte/icons/list-plus';
	import ListTodoIcon from '@lucide/svelte/icons/list-todo';
	import { contactLabel, userLabel } from '#lib/collection.svelte.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { clock } from '#lib/todos/clock.svelte.js';
	import { formatDue, titleFromText } from '#lib/todos/due.js';
	import { useLeadTodos, type LeadTodoStore } from '#lib/todos/lead.svelte.js';
	import TodoForm from '#lib/todos/TodoForm.svelte';
	import { MAX_TITLE } from '#lib/todos/types.js';
	import Attachment from './Attachment.svelte';
	import { formatTime } from './format';
	import { sanitizeHtml } from './sanitize';
	import { typeLabel, type Activity } from './types';
	import './activity-html.css';

	type Props = {
		activity: Activity;
		onedit: (a: Activity) => void;
		ondelete: (a: Activity) => void;
	};
	let { activity, onedit, ondelete }: Props = $props();

	let expanded = $state(false);
	let showImages = $state(false);

	// F7: to-dos made from this note (shared store of the lead: one subscription for all notes)
	const canMakeTodo = $derived(activity.type === 'note' || activity.type === 'meeting');
	let todos = $state<LeadTodoStore | null>(null);
	$effect(() => {
		const h = useLeadTodos(activity.lead);
		todos = h.store;
		return h.release;
	});
	const fromHere = $derived(todos?.fromActivity(activity.id) ?? []);
	let bodyEl = $state<HTMLElement | null>(null);
	let todoOpen = $state(false);
	let todoTitle = $state('');
	let selected = '';

	// read on pointerdown: the selection is still there before the click moves focus
	function rememberSelection() {
		const sel = window.getSelection();
		const inBody =
			sel && sel.rangeCount > 0 && !sel.isCollapsed && bodyEl?.contains(sel.getRangeAt(0).commonAncestorContainer);
		selected = inBody ? sel.toString() : '';
	}

	function makeTodo() {
		todoTitle = titleFromText(selected, MAX_TITLE) || activity.subject.trim().slice(0, MAX_TITLE);
		selected = '';
		todoOpen = true;
	}

	// sanitised on every display, never stored: the stored HTML may come from anywhere
	const clean = $derived(sanitizeHtml(activity.body, { allowImages: showImages }));
	const style = $derived(TYPE_STYLE[activity.type] ?? TYPE_STYLE.note);
	const people = $derived(activity.contacts.map(contactLabel).filter(Boolean));
	const collapsed = $derived(clean.long && !expanded);
</script>

<article
	id="activity-{activity.id}"
	class="activity-item group flex gap-3 rounded-md py-3 transition-shadow"
	aria-label="{typeLabel(activity.type)}: {activity.subject}"
>
	<span class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full {style.tone}" title={typeLabel(activity.type)}>
		<style.icon class="size-4" />
	</span>

	<div class="min-w-0 flex-1">
		<header class="flex flex-wrap items-baseline gap-x-2">
			<h3 class="min-w-0 font-medium break-words">
				{activity.subject || typeLabel(activity.type)}
			</h3>
			{#if activity.subject}<span class="text-xs text-muted-foreground">{typeLabel(activity.type)}</span>{/if}
			<span class="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
				<time datetime={activity.occurred_at.replace(' ', 'T')}>{formatTime(activity.occurred_at)}</time>
				· {userLabel(activity.author) || 'Unbekannt'}
				<span class="flex opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
					{#if canMakeTodo}
						<Button
							variant="ghost"
							size="icon-xs"
							aria-label="To-Do daraus anlegen"
							title="To-Do daraus anlegen (markierter Text wird der Titel)"
							disabled={!todos}
							onpointerdown={rememberSelection}
							onclick={makeTodo}
						>
							<ListPlusIcon />
						</Button>
					{/if}
					<Button variant="ghost" size="icon-xs" aria-label="Aktivität bearbeiten" title="Bearbeiten" onclick={() => onedit(activity)}>
						<PencilIcon />
					</Button>
					<Button variant="ghost" size="icon-xs" aria-label="Aktivität löschen" title="Löschen" onclick={() => ondelete(activity)}>
						<Trash2Icon />
					</Button>
				</span>
			</span>
		</header>

		{#if people.length}
			<p class="text-xs text-muted-foreground">{style.people}: {people.join(', ')}</p>
		{/if}

		<div class="relative mt-1">
			<div bind:this={bodyEl} class="activity-html text-sm {collapsed ? 'max-h-32 overflow-hidden' : ''}">
				<!-- sanitizeHtml: allowlist of the editor's tags, no scripts/handlers/external images -->
				{@html clean.html}
			</div>
			{#if collapsed}
				<div class="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-card to-transparent"></div>
			{/if}
		</div>
		{#if clean.long}
			<button type="button" class="mt-1 text-xs font-medium text-primary hover:underline" aria-expanded={expanded} onclick={() => (expanded = !expanded)}>
				{expanded ? 'weniger' : 'mehr'}
			</button>
		{/if}

		{#if clean.blockedImages > 0 && !showImages}
			<p class="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
				<ImageOffIcon class="size-3.5" />
				{clean.blockedImages === 1 ? '1 externes Bild' : `${clean.blockedImages} externe Bilder`} nicht geladen (Schutz vor Tracking).
				<button type="button" class="font-medium text-primary hover:underline" onclick={() => (showImages = true)}>Bilder anzeigen</button>
			</p>
		{/if}

		{#if activity.attachments.length}
			<ul class="mt-2 grid gap-1.5 sm:grid-cols-2" aria-label="Anhänge">
				{#each activity.attachments as name (name)}
					<Attachment {activity} {name} />
				{/each}
			</ul>
		{/if}

		{#if fromHere.length}
			<ul class="mt-2 flex flex-col gap-0.5 text-xs text-muted-foreground" aria-label="Daraus entstandene To-Dos">
				{#each fromHere as t (t.id)}
					<li class="flex min-w-0 items-center gap-1.5">
						<ListTodoIcon class="size-3.5 shrink-0" />
						<span class="sr-only">To-Do:</span>
						<span class="min-w-0 truncate {t.done ? 'line-through' : ''}">{t.title}</span>
						<span class="shrink-0">· {t.done ? 'erledigt' : formatDue(t, clock.now)}</span>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</article>

{#if todoOpen && todos}
	{@const store = todos}
	<TodoForm
		bind:open={todoOpen}
		initialTitle={todoTitle}
		description="Aus „{activity.subject || typeLabel(activity.type)}“"
		save={(data) => store.create({ ...data, source_activity: activity.id })}
	/>
{/if}

<style>
	/* off-screen items skip layout and paint: a lead with 500 activities scrolls smoothly */
	.activity-item {
		content-visibility: auto;
		contain-intrinsic-size: auto 7rem;
	}
</style>
