<script lang="ts">
	import '../app.css';
	import favicon from '#lib/assets/favicon.svg';
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
	<link rel="icon" href={favicon} />
	<title>CRM</title>
</svelte:head>

{#if isLogin}
	{@render children()}
{:else if auth.loggedIn}
	<header class="flex h-(--header-h) items-center gap-6 border-b bg-card px-4">
		<a href="/leads" class="font-semibold">CRM</a>
		<nav class="flex flex-1 gap-1 text-sm">
			{#each NAV as item (item.href)}
				<a
					href={item.href}
					aria-current={page.url.pathname.startsWith(item.href) ? 'page' : undefined}
					class="rounded-md px-3 py-1.5 text-muted-foreground hover:text-foreground aria-[current=page]:bg-accent aria-[current=page]:font-medium aria-[current=page]:text-accent-foreground"
				>
					{item.label}
				</a>
			{/each}
		</nav>
		<span class="text-sm text-muted-foreground">{auth.user?.name || auth.user?.email}</span>
		<Button variant="ghost" size="sm" onclick={logout}>Abmelden</Button>
	</header>
	<main class="h-[calc(100dvh-var(--header-h))]">
		{@render children()}
	</main>
{/if}
