<script lang="ts">
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/dialog/index.js';

	type Props = {
		open: boolean;
		title: string;
		description: string;
		confirmLabel?: string;
		onconfirm: () => void;
	};
	let { open = $bindable(), title, description, confirmLabel = 'Löschen', onconfirm }: Props =
		$props();
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-sm">
		<Dialog.Header>
			<Dialog.Title>{title}</Dialog.Title>
			<Dialog.Description>{description}</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)}>Abbrechen</Button>
			<Button
				variant="destructive"
				onclick={() => {
					open = false;
					onconfirm();
				}}
			>
				{confirmLabel}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
