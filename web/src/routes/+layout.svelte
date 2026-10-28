<script lang="ts">
	import '../app.css';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import { auth } from '#lib/auth.svelte.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	const NAV = [
		{ href: '/leads', label: 'Leads' },
		{ href: '/kontakte', label: 'Kontakte' },
		{ href: '/unternehmen', label: 'Unternehmen' }
	];

	const isLogin = $derived(page.url.pathname === '/login');
	const userName = $derived(auth.user?.name || auth.user?.email || '');

	auth.refresh();

	$effect(() => {
		if (!auth.loggedIn && !isLogin) goto('/login');
		else if (auth.loggedIn && isLogin) goto('/');
	});

	function logout() {
		auth.logout();
		goto('/login');
	}
</script>

<svelte:head>
	<!-- web/static/favicon.ico: browsers ask for /favicon.ico before this script runs -->
	<link rel="icon" href="/favicon.ico" sizes="any" />
	<title>CRM</title>
</svelte:head>

{#if isLogin}
	{@render children()}
{:else if auth.loggedIn}
	<!-- phones (390 px): tighter gaps, no user name, "Abmelden" as icon; the navigation
	     scrolls sideways instead of pushing the button off the screen -->
	<header class="flex h-(--header-h) items-center gap-2 border-b bg-card px-3 sm:gap-6 sm:px-4">
		<a href="/leads" class="shrink-0 font-semibold">CRM</a>
		<nav class="flex min-w-0 flex-1 gap-1 overflow-x-auto text-sm" aria-label="Hauptnavigation">
			{#each NAV as item (item.href)}
				<a
					href={item.href}
					aria-current={page.url.pathname.startsWith(item.href) ? 'page' : undefined}
					class="shrink-0 rounded-md px-2 py-1.5 whitespace-nowrap text-muted-foreground hover:text-foreground aria-[current=page]:bg-accent aria-[current=page]:font-medium aria-[current=page]:text-accent-foreground sm:px-3"
				>
					{item.label}
				</a>
			{/each}
		</nav>
		<span class="hidden max-w-48 truncate text-sm text-muted-foreground sm:inline">{userName}</span>
		<Button
			variant="ghost"
			size="sm"
			class="shrink-0"
			aria-label="Abmelden"
			title={userName ? `Abmelden (${userName})` : 'Abmelden'}
			onclick={logout}
		>
			<LogOutIcon class="sm:hidden" />
			<span class="hidden sm:inline">Abmelden</span>
		</Button>
	</header>
	<main class="h-[calc(100dvh-var(--header-h))]">
		{@render children()}
	</main>
{/if}
