<script lang="ts">
	import { onMount, getContext } from "svelte";
	import { fetchSessions, type SessionInfo } from "$lib/api.js";
	import type { DashboardWsClient } from "$lib/ws.js";

	let sessions = $state<SessionInfo[]>([]);
	let loadError = $state<string | null>(null);

	const wsState = getContext<{ client: DashboardWsClient | null; connected: boolean }>("ws");

	function formatRelativeTime(timestamp: number): string {
		if (!timestamp) return "Unknown";
		const diff = Date.now() - timestamp;
		if (diff < 0) return "just now";
		const seconds = Math.floor(diff / 1000);
		if (seconds < 60) return `${seconds}s ago`;
		const minutes = Math.floor(seconds / 60);
		if (minutes < 60) return `${minutes}m ago`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		return `${days}d ago`;
	}

	function truncateId(id: string): string {
		return id.length > 12 ? id.slice(0, 12) + "..." : id;
	}

	async function loadSessions() {
		try {
			sessions = await fetchSessions();
		} catch (err) {
			loadError = err instanceof Error ? err.message : String(err);
		}
	}

	onMount(() => {
		loadSessions();

		let cleanupWs: (() => void) | null = null;

		const checkInterval = setInterval(() => {
			const client = wsState?.client;
			if (client) {
				clearInterval(checkInterval);
				const unsub = client.onSessionChanged(() => {
					loadSessions();
				});
				cleanupWs = unsub;
			}
		}, 100);

		return () => {
			clearInterval(checkInterval);
			cleanupWs?.();
		};
	});
</script>

<svelte:head>
	<title>Sessions - Dashboard</title>
</svelte:head>

<div class="flex h-full w-full flex-col">
	{#if loadError}
		<div
			class="absolute top-12 right-3 z-50 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-red-400 shadow-lg backdrop-blur-sm"
		>
			<svg class="size-3.5 shrink-0" viewBox="0 0 16 16" fill="currentColor">
				<path
					d="M8 1a7 7 0 100 14A7 7 0 008 1zm-.75 4.75a.75.75 0 011.5 0v3a.75.75 0 01-1.5 0v-3zm.75 6a.75.75 0 110-1.5.75.75 0 010 1.5z"
				/>
			</svg>
			{loadError}
			<button
				class="ml-1 rounded p-0.5 opacity-60 transition-opacity hover:opacity-100"
				onclick={() => (loadError = null)}
			>
				<svg class="size-3" viewBox="0 0 16 16" fill="currentColor">
					<path
						d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z"
					/>
				</svg>
			</button>
		</div>
	{/if}

	<!-- Header bar -->
	<header class="header-bar flex h-10 shrink-0 items-center gap-3 border-b border-border px-4">
		<div class="flex items-center gap-2">
			<svg class="size-4 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M12 2L2 7l10 5 10-5-10-5z" />
				<path d="M2 17l10 5 10-5" />
				<path d="M2 12l10 5 10-5" />
			</svg>
			<span class="text-sm font-semibold tracking-tight text-foreground">MCP Gateway</span>
		</div>
		<div class="h-4 w-px bg-border"></div>
		<span class="text-xs font-medium text-muted-foreground">Active Sessions</span>
		<div class="ml-auto flex items-center gap-1.5 text-[10px] text-muted-foreground">
			<span class="inline-block size-1.5 rounded-full bg-success animate-pulse"></span>
			{sessions.length} session{sessions.length === 1 ? "" : "s"}
		</div>
	</header>

	<!-- Sessions content -->
	<div class="min-h-0 flex-1 overflow-y-auto p-4">
		{#if sessions.length === 0}
			<div class="flex flex-col items-center justify-center gap-3 py-16">
				<svg class="size-10 text-muted-foreground/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
					<circle cx="12" cy="5" r="3" />
					<circle cx="5" cy="19" r="3" />
					<circle cx="19" cy="19" r="3" />
					<path d="M12 8v4m-5 4l5-4 5 4" />
				</svg>
				<span class="text-xs text-muted-foreground">No active sessions</span>
			</div>
		{:else}
			<div class="grid gap-3" style="grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));">
				{#each sessions as session (session.sessionId)}
					<div class="session-card rounded-lg border border-border p-4">
						<!-- Session ID and timestamps -->
						<div class="flex items-start justify-between gap-3">
							<div class="min-w-0">
								<div class="flex items-center gap-2">
									<span class="font-mono text-xs text-foreground" title={session.sessionId}>
										{truncateId(session.sessionId)}
									</span>
									<button
										class="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
										onclick={() => navigator.clipboard.writeText(session.sessionId)}
										aria-label="Copy session ID"
									>
										<svg class="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
											<rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
											<path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
										</svg>
									</button>
								</div>
								{#if session.workingDirectory}
									<div class="mt-1 truncate font-mono text-[10px] text-muted-foreground" title={session.workingDirectory}>
										{session.workingDirectory}
									</div>
								{/if}
							</div>
							<div class="shrink-0 text-right text-[10px] text-muted-foreground">
								<div>Created {formatRelativeTime(session.createdAt)}</div>
								<div>Active {formatRelativeTime(session.lastActivity)}</div>
							</div>
						</div>

						<!-- Capabilities -->
						<div class="mt-3 flex flex-wrap gap-1.5">
							{#if session.capabilities.sampling}
								<span class="capability-badge">Sampling</span>
							{/if}
							{#if session.capabilities.elicitation}
								<span class="capability-badge">Elicitation</span>
							{/if}
							{#if session.capabilities.roots}
								<span class="capability-badge">Roots</span>
							{/if}
							{#if !session.capabilities.sampling && !session.capabilities.elicitation && !session.capabilities.roots}
								<span class="text-[10px] text-muted-foreground/50 italic">No capabilities</span>
							{/if}
						</div>

						<!-- Connected servers -->
						{#if session.connectedServers.length > 0 || session.failedServers.length > 0}
							<div class="mt-3 flex flex-wrap gap-1.5">
								{#each session.connectedServers as server}
									<span class="server-chip connected">
										<span class="size-1.5 rounded-full bg-success"></span>
										{server}
									</span>
								{/each}
								{#each session.failedServers as failed}
									<span class="server-chip failed" title={failed.error}>
										<span class="size-1.5 rounded-full bg-destructive"></span>
										{failed.name}
									</span>
								{/each}
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>

<style>
	.header-bar {
		background: linear-gradient(
			180deg,
			oklch(0.17 0.015 260) 0%,
			oklch(0.14 0.012 260) 100%
		);
	}

	.session-card {
		background: oklch(0.155 0.012 260);
	}

	.capability-badge {
		display: inline-flex;
		align-items: center;
		border-radius: 9999px;
		padding: 2px 8px;
		font-size: 10px;
		font-weight: 500;
		background: oklch(0.78 0.145 70 / 0.1);
		color: oklch(0.78 0.145 70);
		border: 1px solid oklch(0.78 0.145 70 / 0.2);
	}

	.server-chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		border-radius: 6px;
		padding: 2px 8px;
		font-size: 10px;
		font-family: var(--font-mono);
		font-weight: 500;
	}

	.server-chip.connected {
		background: oklch(0.65 0.14 162 / 0.1);
		color: oklch(0.65 0.14 162);
		border: 1px solid oklch(0.65 0.14 162 / 0.2);
	}

	.server-chip.failed {
		background: oklch(0.55 0.2 25 / 0.1);
		color: oklch(0.65 0.15 25);
		border: 1px solid oklch(0.55 0.2 25 / 0.2);
		cursor: help;
	}
</style>
