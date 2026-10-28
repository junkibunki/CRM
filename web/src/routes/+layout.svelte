<script lang="ts">
	import favicon from '#lib/assets/favicon.svg';
	import { auth } from '#lib/auth.svelte.js';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

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
	<header>
		<strong>CRM</strong>
		<nav>
			<a href="/">Übersicht</a>
		</nav>
		<span class="user">{auth.user?.email}</span>
		<button onclick={logout}>Abmelden</button>
	</header>
	<main>
		{@render children()}
	</main>
{/if}

<style>
	:global(body) {
		margin: 0;
		font-family: system-ui, sans-serif;
		color: #1f2937;
		background: #f9fafb;
	}
	header {
		display: flex;
		align-items: center;
		gap: 1.5rem;
		padding: 0.75rem 1.5rem;
		background: #fff;
		border-bottom: 1px solid #e5e7eb;
	}
	nav {
		display: flex;
		gap: 1rem;
		flex: 1;
	}
	.user {
		color: #6b7280;
		font-size: 0.875rem;
	}
	main {
		padding: 1.5rem;
	}
</style>
