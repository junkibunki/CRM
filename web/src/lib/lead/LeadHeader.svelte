<script lang="ts">
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import UserIcon from '@lucide/svelte/icons/user';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import { userLabel } from '#lib/collection.svelte.js';
	import { COLUMN_COLORS, type Lead } from '#lib/types.js';
	import { cn } from '#lib/utils.js';
	import { formatDateTime, formatDay } from './format';
	import type { LeadStore } from './lead.svelte';

	type Props = { store: LeadStore; lead: Lead; onedit: () => void; ondelete: () => void };
	let { store, lead, onedit, ondelete }: Props = $props();

	const stage = $derived(store.stage);
	const close = $derived(formatDay(lead.expected_close));
	const created = $derived(formatDateTime(lead.created));
	const owner = $derived(userLabel(lead.owner));

	const dot = (color: string) =>
		COLUMN_COLORS[color as keyof typeof COLUMN_COLORS]?.dot ?? COLUMN_COLORS.gray.dot;
</script>

<div class="flex flex-col gap-3">
	<div>
		<Button href="/leads" variant="ghost" size="sm" class="-ml-2">
			<ArrowLeftIcon /> Zurück zur Pipeline
		</Button>
	</div>

	<div class="flex flex-wrap items-start gap-3">
		<h1 class="mr-auto min-w-0 text-xl font-semibold break-words">{lead.title}</h1>
		<div class="flex gap-2">
			<Button variant="outline" onclick={onedit}><PencilIcon /> Bearbeiten</Button>
			<Button variant="ghost" onclick={ondelete}>
				<Trash2Icon /> Löschen
			</Button>
		</div>
	</div>

	<dl class="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
		<div class="flex items-center gap-2">
			<dt class="text-muted-foreground">Phase</dt>
			<dd>
				<!-- the getter keeps the trigger on the lead's real stage: a pick only moves it via the
				     store, and re-picking the current item (bits-ui deselect to '') does nothing -->
				<Select.Root
					type="single"
					bind:value={() => lead.column, (v) => store.moveToStage(v)}
				>
					<Select.Trigger class="min-w-40" aria-label="Phase">
						<span class="flex items-center gap-2">
							<span class={cn('size-2 shrink-0 rounded-full', dot(stage?.color ?? ''))}></span>
							{stage?.name ?? '–'}
						</span>
					</Select.Trigger>
					<Select.Content>
						{#each store.stages as s (s.id)}
							<Select.Item value={s.id} label={s.name}>
								<span class="flex items-center gap-2">
									<span class={cn('size-2 shrink-0 rounded-full', dot(s.color))}></span>
									{s.name}
								</span>
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</dd>
		</div>
		<div class="flex items-center gap-1.5">
			<dt class="flex items-center gap-1.5 text-muted-foreground"><UserIcon class="size-4" /> Zuständig</dt>
			<dd>{owner || '–'}</dd>
		</div>
		<div class="flex items-center gap-1.5">
			<dt class="flex items-center gap-1.5 text-muted-foreground">
				<CalendarIcon class="size-4" /> Voraussichtlicher Abschluss
			</dt>
			<dd>{close || '–'}</dd>
		</div>
		<div class="flex items-center gap-1.5">
			<dt class="flex items-center gap-1.5 text-muted-foreground"><ClockIcon class="size-4" /> Erstellt am</dt>
			<dd>{created}</dd>
		</div>
	</dl>
</div>
