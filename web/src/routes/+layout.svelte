<script lang="ts">
	import '../app.css';
	import { auth } from '#lib/auth.svelte.js';
	import UserMenu from '#lib/profile/UserMenu.svelte';
	import NavCounter from '#lib/todos/NavCounter.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	const NAV = [
		{ href: '/leads', label: 'Leads' },
		{ href: '/todos', label: 'To-Dos' },
		{ href: '/kontakte', label: 'Kontakte' },
		{ href: '/unternehmen', label: 'Unternehmen' }
	];

	const isLogin = $derived(page.url.pathname === '/login');

	auth.refresh();

	$effect(() => {
		if (!auth.loggedIn && !isLogin) goto('/login');
		else if (auth.loggedIn && isLogin) goto('/');
	});
</script>

<svelte:head>
	<!-- web/static/favicon.ico: browsers ask for /favicon.ico before this script runs -->
	<link rel="icon" href="/favicon.ico" sizes="any" />
	<title>CRM</title>
</svelte:head>

{#if isLogin}
	{@render children()}
{:else if auth.loggedIn}
	<!-- phones (390 px): tighter gaps; the navigation scrolls sideways instead of pushing the
	     user menu (profile, dark mode, logout) off the screen -->
	<header class="flex h-(--header-h) items-center gap-2 border-b bg-card px-3 sm:gap-6 sm:px-4">
		<a href="/leads" class="flex shrink-0 items-center gap-2" aria-label="BlueBerk CRM – Leads">
			<span class="bb-logo h-7 text-bb-navy dark:text-foreground" aria-hidden="true"></span>
			<span class="border-l pl-2 text-sm font-semibold text-muted-foreground">CRM</span>
		</a>
		<nav class="flex min-w-0 flex-1 gap-1 overflow-x-auto text-sm" aria-label="Hauptnavigation">
			{#each NAV as item (item.href)}
				<a
					href={item.href}
					aria-current={page.url.pathname.startsWith(item.href) ? 'page' : undefined}
					class="shrink-0 rounded-md px-2 py-1.5 whitespace-nowrap text-muted-foreground hover:text-foreground aria-[current=page]:bg-accent aria-[current=page]:font-medium aria-[current=page]:text-accent-foreground sm:px-3"
				>
					{item.label}
					{#if item.href === '/todos'}<NavCounter />{/if}
				</a>
			{/each}
		</nav>
		<UserMenu />
	</header>
	<main class="h-[calc(100dvh-var(--header-h))]">
		{@render children()}
	</main>
{/if}
