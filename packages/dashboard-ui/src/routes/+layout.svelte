<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { onMount, setContext } from 'svelte';
	import { createDashboardWs, type DashboardWsClient } from '$lib/ws.js';
	import Sidebar from '$lib/components/Sidebar.svelte';

	let { children } = $props();

	const wsState = $state<{ client: DashboardWsClient | null; connected: boolean }>({
		client: null,
		connected: false,
	});

	setContext('ws', wsState);

	onMount(() => {
		const client = createDashboardWs();
		wsState.client = client;

		// Poll connected status since WS client uses plain getters
		const poll = setInterval(() => {
			wsState.connected = client.connected;
		}, 500);

		return () => {
			clearInterval(poll);
			client.close();
		};
	});
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
<div class="flex h-screen w-screen overflow-hidden">
	<Sidebar wsConnected={wsState.connected} />
	<main class="min-w-0 flex-1">
		{@render children()}
	</main>
</div>
