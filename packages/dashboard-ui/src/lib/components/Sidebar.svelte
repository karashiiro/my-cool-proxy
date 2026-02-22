<script lang="ts">
	import { page } from "$app/state";

	let { wsConnected = false }: { wsConnected?: boolean } = $props();

	const navItems = [
		{
			label: "Executions",
			href: "/",
			icon: "clipboard",
		},
		{
			label: "Sessions",
			href: "/sessions",
			icon: "network",
		},
	] as const;
</script>

<aside class="sidebar flex h-screen flex-col border-r border-border">
	<nav class="flex flex-1 flex-col gap-1 py-2">
		{#each navItems as item}
			{@const isActive = page.url.pathname === item.href}
			<a
				href={item.href}
				aria-label={item.label}
				aria-current={isActive ? "page" : undefined}
				class="nav-item relative flex items-center gap-3 px-3 py-2.5 text-sm transition-colors"
				class:active={isActive}
			>
				{#if isActive}
					<span class="active-indicator absolute left-0 top-0 h-full w-0.5 rounded-r bg-primary"></span>
				{/if}

				<span class="icon shrink-0">
					{#if item.icon === "clipboard"}
						<svg
							class="size-5"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="1.75"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
							<rect x="9" y="3" width="6" height="4" rx="1" />
						</svg>
					{:else if item.icon === "network"}
						<svg
							class="size-5"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="1.75"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<circle cx="12" cy="5" r="3" />
							<circle cx="5" cy="19" r="3" />
							<circle cx="19" cy="19" r="3" />
							<path d="M12 8v4m-5 4l5-4 5 4" />
						</svg>
					{/if}
				</span>

				<span class="label truncate text-xs font-medium">{item.label}</span>
			</a>
		{/each}
	</nav>

	<!-- Connection status -->
	<div class="status-row flex items-center gap-3 border-t border-border py-3" style="padding-left: 18px;" role="status" aria-label={wsConnected ? "WebSocket connected" : "WebSocket disconnected"}>
		<span
			class="status-dot size-2 shrink-0 rounded-full"
			class:connected={wsConnected}
			class:disconnected={!wsConnected}
		></span>
		<span class="status-label truncate text-xs text-muted-foreground">
			{wsConnected ? "Connected" : "Disconnected"}
		</span>
	</div>
</aside>

<style>
	.sidebar {
		width: 48px;
		background: oklch(0.13 0.012 260);
		overflow: hidden;
		transition: width 200ms ease;
	}

	.sidebar:hover,
	.sidebar:focus-within {
		width: 200px;
	}

	.nav-item {
		color: var(--color-muted-foreground);
		white-space: nowrap;
	}

	.nav-item:hover {
		color: var(--color-foreground);
		background: oklch(0.18 0.012 260);
	}

	.nav-item.active {
		color: var(--color-foreground);
		background: oklch(0.17 0.015 260);
	}

	.label {
		opacity: 0;
		transition: opacity 150ms ease;
		pointer-events: none;
	}

	.sidebar:hover .label,
	.sidebar:focus-within .label {
		opacity: 1;
	}

	.status-label {
		opacity: 0;
		transition: opacity 150ms ease;
	}

	.sidebar:hover .status-label,
	.sidebar:focus-within .status-label {
		opacity: 1;
	}

	.status-dot.connected {
		background-color: var(--color-success);
	}

	.status-dot.disconnected {
		background-color: oklch(0.55 0.2 25);
	}
</style>
