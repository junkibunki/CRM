<script lang="ts">
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import MoonIcon from '@lucide/svelte/icons/moon';
	import UserIcon from '@lucide/svelte/icons/user';
	import { DropdownMenu as MenuPrimitive } from 'bits-ui';
	import { auth } from '#lib/auth.svelte.js';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
	import { theme } from '#lib/theme.svelte.js';
	import { goto } from '$app/navigation';
	import UserAvatar from './UserAvatar.svelte';

	const name = $derived(auth.user?.name || auth.user?.email || '');

	function logout() {
		auth.logout();
		goto('/login');
	}
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger
		class="shrink-0 rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
		aria-label="Benutzermenü"
		title={name}
	>
		<UserAvatar user={auth.user} />
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="end" class="w-60">
		<DropdownMenu.Label class="flex items-center gap-2 font-normal">
			<UserAvatar user={auth.user} size="lg" />
			<div class="grid min-w-0 text-sm leading-tight">
				<span class="truncate font-medium">{auth.user?.name || 'Ohne Namen'}</span>
				<span class="truncate text-xs text-muted-foreground">{auth.user?.email}</span>
			</div>
		</DropdownMenu.Label>
		<DropdownMenu.Separator />
		<DropdownMenu.Item onSelect={() => goto('/profil')}>
			<UserIcon />
			Profil
		</DropdownMenu.Item>
		<!-- the shadcn checkbox item draws a check mark; this one draws a switch and stays open -->
		<MenuPrimitive.CheckboxItem
			checked={theme.dark}
			onCheckedChange={(v) => theme.setDark(v)}
			closeOnSelect={false}
			class="flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
		>
			<MoonIcon />
			<span class="flex-1">Dunkles Design</span>
			<span
				aria-hidden="true"
				class="inline-flex h-[18px] w-8 shrink-0 items-center rounded-full border border-transparent p-px transition-colors {theme.dark
					? 'bg-primary'
					: 'bg-input'}"
			>
				<span
					class="block size-3.5 rounded-full shadow-xs transition-transform {theme.dark
						? 'translate-x-3.5 bg-primary-foreground'
						: 'bg-background'}"
				></span>
			</span>
		</MenuPrimitive.CheckboxItem>
		<DropdownMenu.Separator />
		<DropdownMenu.Item onSelect={logout}>
			<LogOutIcon />
			Abmelden
		</DropdownMenu.Item>
	</DropdownMenu.Content>
</DropdownMenu.Root>
