<script lang="ts">
	import { Badge } from "$lib/components/ui/badge/index.js";
	import type { LuaExecution } from "$lib/types.js";
	import type { ToolUsage } from "$lib/api.js";

	let {
		executions,
		selectedId,
		onselect,
		hasMore = false,
		loadingMore = false,
		onloadmore,
		tools = [],
		activeFilter = null,
		onfilter,
	}: {
		executions: LuaExecution[];
		selectedId: string | null;
		onselect?: (id: string) => void;
		hasMore?: boolean;
		loadingMore?: boolean;
		onloadmore?: () => void;
		tools?: ToolUsage[];
		activeFilter?: string | null;
		onfilter?: (tool: string | null) => void;
	} = $props();

	let filterOpen = $state(false);
	let filterButtonEl = $state<HTMLButtonElement | null>(null);
	let dropdownPos = $derived.by(() => {
		if (!filterOpen || !filterButtonEl) return { top: 0, left: 0 };
		const rect = filterButtonEl.getBoundingClientRect();
		return { top: rect.bottom + 4, left: rect.left };
	});

	function formatTime(timestamp: number): string {
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

	function truncateScript(script: string): string {
		const firstLine =
			script
				.split("\n")
				.map((l) => l.trim())
				.find((l) => l.length > 0) ?? script.trim();
		return firstLine.length > 60 ? firstLine.slice(0, 57) + "..." : firstLine;
	}

	function selectTool(tool: string | null) {
		onfilter?.(tool);
		filterOpen = false;
	}
</script>

<div class="flex h-full flex-col overflow-hidden bg-card/50">
	<div class="section-header flex items-center gap-2 border-b border-border px-4 py-2.5">
		<svg class="size-3.5 text-primary/70" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
			<path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
			<rect x="9" y="3" width="6" height="4" rx="1" />
		</svg>
		<h2 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Executions</h2>
		{#if tools.length > 0}
			<div class="relative ml-auto">
				<button
					bind:this={filterButtonEl}
					class="filter-button flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-medium transition-colors
						{activeFilter ? 'bg-primary/15 text-primary border border-primary/30' : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'}"
					onclick={() => (filterOpen = !filterOpen)}
					aria-haspopup="listbox"
					aria-expanded={filterOpen}
					aria-label={activeFilter ? `Filtered by ${activeFilter}` : "Filter by tool"}
				>
					<svg class="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
					</svg>
					{#if activeFilter}
						{activeFilter}
					{:else}
						Filter
					{/if}
				</button>
				{#if filterOpen}
					<div
						class="filter-dropdown fixed z-50 min-w-[200px] max-w-[300px] rounded-lg border border-border bg-card shadow-xl"
						style="top: {dropdownPos.top}px; left: {dropdownPos.left}px;"
						role="listbox"
						tabindex="-1"
						aria-label="Filter by tool"
						onkeydown={(e) => { if (e.key === "Escape") filterOpen = false; }}
					>
						<div class="max-h-[240px] overflow-y-auto p-1">
							{#if activeFilter}
								<button
									class="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
									onclick={() => selectTool(null)}
								>
									<svg class="size-3 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
										<path d="M18 6L6 18M6 6l12 12" />
									</svg>
									Clear filter
								</button>
								<div class="mx-2 my-1 border-t border-border/50"></div>
							{/if}
							{#each tools as t (t.tool)}
								<button
									role="option"
									aria-selected={activeFilter === t.tool}
									class="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-[11px] transition-colors hover:bg-accent/50
										{activeFilter === t.tool ? 'text-primary font-medium' : 'text-foreground/85'}"
									onclick={() => selectTool(t.tool)}
								>
									<span class="truncate font-mono">{t.tool}</span>
									<span class="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
										{t.count}
									</span>
								</button>
							{/each}
						</div>
					</div>
				{/if}
			</div>
		{/if}
	</div>
	{#if activeFilter}
		<div class="flex items-center gap-2 border-b border-border/50 bg-primary/5 px-3 py-1.5">
			<span class="text-[10px] text-muted-foreground">Filtered by:</span>
			<span class="font-mono text-[10px] text-primary">{activeFilter}</span>
			<button
				class="ml-auto text-muted-foreground transition-colors hover:text-foreground"
				onclick={() => onfilter?.(null)}
				aria-label={`Clear filter: ${activeFilter}`}
			>
				<svg class="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M18 6L6 18M6 6l12 12" />
				</svg>
			</button>
		</div>
	{/if}
	{#if executions.length === 0}
		<div class="flex flex-1 flex-col items-center justify-center gap-3 p-6">
			<svg class="size-8 text-muted-foreground/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
				<path d="M14.25 9.75L16.5 12l-2.25 2.25" />
				<path d="M9.75 9.75L7.5 12l2.25 2.25" />
				<circle cx="12" cy="12" r="10" />
			</svg>
			<span class="text-xs text-muted-foreground">
				{#if activeFilter}
					No executions match this filter
				{:else}
					No executions yet
				{/if}
			</span>
		</div>
	{:else}
		<div class="min-h-0 flex-1 overflow-y-auto">
			<div class="flex flex-col gap-0.5 p-1.5">
				{#each executions as execution (execution.executionId)}
					{@const isSelected = selectedId === execution.executionId}
					<button
						class="execution-item w-full rounded-lg px-3 py-2.5 text-left transition-all duration-150
							{isSelected ? 'selected' : 'hover:bg-accent/50'}"
						data-selected={isSelected ? "" : undefined}
						onclick={() => onselect?.(execution.executionId)}
					>
						<div class="flex items-start justify-between gap-2">
							<span class="truncate font-mono text-[11px] leading-relaxed text-foreground/85">
								{truncateScript(execution.script)}
							</span>
							<Badge
								variant={execution.status === "success" ? "default" : "destructive"}
								class="shrink-0 text-[9px] font-semibold uppercase tracking-wider {execution.status === 'success'
									? 'bg-success/15 text-success border-success/20'
									: ''}"
							>
								{execution.status}
							</Badge>
						</div>
						<div class="mt-1.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
							<svg class="size-2.5 opacity-50" viewBox="0 0 16 16" fill="currentColor">
								<path d="M8 0a8 8 0 100 16A8 8 0 008 0zm.5 4.5v4l3 1.5-.5 1-3.5-1.75V4.5h1z" />
							</svg>
							{formatTime(execution.createdAt)}
						</div>
					</button>
				{/each}
				{#if hasMore}
					<button
						class="mt-1 w-full rounded-lg px-3 py-2.5 text-center text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground disabled:opacity-40"
						disabled={loadingMore}
						onclick={() => onloadmore?.()}
					>
						{#if loadingMore}
							Loading...
						{:else}
							Load more
						{/if}
					</button>
				{/if}
			</div>
		</div>
	{/if}
</div>

<!-- Close filter dropdown when clicking outside -->
{#if filterOpen}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-40"
		onclick={() => (filterOpen = false)}
		onkeydown={(e) => { if (e.key === "Escape") filterOpen = false; }}
	></div>
{/if}

<style>
	.section-header {
		background: linear-gradient(
			180deg,
			oklch(0.17 0.015 260) 0%,
			oklch(0.15 0.012 260) 100%
		);
	}

	.execution-item.selected {
		background: oklch(0.2 0.02 260);
		box-shadow:
			inset 2px 0 0 oklch(0.78 0.145 70),
			0 0 12px -4px oklch(0.78 0.145 70 / 0.15);
	}

	.filter-dropdown {
		background: oklch(0.16 0.015 260);
	}
</style>
